import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Server } from "node:http";
import { createAuditViewerServer, loadAuditViewerConfig } from "../apps/audit-viewer/src/app.js";
import type { AuditEvent } from "../packages/shared/src/types.js";

test("audit viewer defaults to unauthenticated loopback mode", () => {
  const config = loadAuditViewerConfig({});

  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 1787);
  assert.equal(config.auth.enabled, false);
});

test("audit viewer refuses non-loopback binds without explicit remote opt-in", () => {
  assert.throws(
    () => loadAuditViewerConfig({ AUDIT_VIEWER_HOST: "0.0.0.0", AUDIT_VIEWER_PASSWORD: "correct horse battery staple" }),
    /AUDIT_VIEWER_ALLOW_REMOTE=true/
  );
});

test("audit viewer refuses remote opt-in or required auth without a password", () => {
  assert.throws(
    () => loadAuditViewerConfig({ AUDIT_VIEWER_HOST: "0.0.0.0", AUDIT_VIEWER_ALLOW_REMOTE: "true" }),
    /AUDIT_VIEWER_PASSWORD/
  );

  assert.throws(() => loadAuditViewerConfig({ AUDIT_VIEWER_REQUIRE_AUTH: "true" }), /AUDIT_VIEWER_PASSWORD/);
});

test("audit viewer rejects placeholder passwords", () => {
  assert.throws(
    () =>
      loadAuditViewerConfig({
        AUDIT_VIEWER_ALLOW_REMOTE: "true",
        AUDIT_VIEWER_HOST: "0.0.0.0",
        AUDIT_VIEWER_PASSWORD: "change-me"
      }),
    /placeholder/
  );
});

test("local audit viewer serves dashboard and events without auth", async () => {
  const temp = await createStateFile();
  const config = loadAuditViewerConfig({ CODEX_STATE_PATH: temp.statePath });
  const { server, baseUrl } = await startTestServer(createAuditViewerServer(config));

  try {
    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    const pageBody = await page.text();
    assert.match(pageBody, /Codex Relay Audit/);
    assert.match(pageBody, /Store: JSON/);
    assert.equal(pageBody.includes(temp.statePath), false);

    const events = await fetch(`${baseUrl}/events.json`);
    assert.equal(events.status, 200);
    const body = (await events.json()) as { count: number; events: AuditEvent[] };
    assert.equal(body.count, 1);
    assert.equal(body.events[0]?.summary, "Allowed task.");
  } finally {
    await closeServer(server);
    await rm(temp.dir, { recursive: true, force: true });
  }
});

test("authenticated audit viewer protects dashboard and events", async () => {
  const temp = await createStateFile();
  const password = "correct horse battery staple";
  const config = loadAuditViewerConfig({
    AUDIT_VIEWER_REQUIRE_AUTH: "true",
    AUDIT_VIEWER_USERNAME: "operator",
    AUDIT_VIEWER_PASSWORD: password,
    CODEX_STATE_PATH: temp.statePath
  });
  const { server, baseUrl } = await startTestServer(createAuditViewerServer(config));

  try {
    const denied = await fetch(`${baseUrl}/events.json`);
    assert.equal(denied.status, 401);
    const deniedBody = await denied.text();
    assert.equal(deniedBody.includes(password), false);
    assert.equal(deniedBody.includes(temp.statePath), false);

    const wrongPassword = await fetch(`${baseUrl}/events.json`, {
      headers: { authorization: basicAuth("operator", "wrong") }
    });
    assert.equal(wrongPassword.status, 401);

    const allowed = await fetch(`${baseUrl}/events.json`, {
      headers: { authorization: basicAuth("operator", password) }
    });
    assert.equal(allowed.status, 200);
    const body = (await allowed.json()) as { count: number; events: AuditEvent[] };
    assert.equal(body.count, 1);

    const page = await fetch(`${baseUrl}/`, {
      headers: { authorization: basicAuth("operator", password) }
    });
    assert.equal(page.status, 200);
  } finally {
    await closeServer(server);
    await rm(temp.dir, { recursive: true, force: true });
  }
});

test("remote audit viewer opt-in requires auth and keeps health checks public", async () => {
  const temp = await createStateFile();
  const password = "correct horse battery staple";
  const config = loadAuditViewerConfig({
    AUDIT_VIEWER_HOST: "0.0.0.0",
    AUDIT_VIEWER_ALLOW_REMOTE: "true",
    AUDIT_VIEWER_PASSWORD: password,
    CODEX_STATE_PATH: temp.statePath
  });
  const { server, baseUrl } = await startTestServer(createAuditViewerServer(config), "0.0.0.0", "127.0.0.1");

  try {
    assert.equal(config.auth.enabled, true);

    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "ok\n");

    const deniedPage = await fetch(`${baseUrl}/`);
    assert.equal(deniedPage.status, 401);

    const allowedPage = await fetch(`${baseUrl}/`, {
      headers: { authorization: basicAuth("codex-relay", password) }
    });
    assert.equal(allowedPage.status, 200);
    const pageBody = await allowedPage.text();
    assert.match(pageBody, /Store: JSON/);
    assert.equal(pageBody.includes(temp.statePath), false);
  } finally {
    await closeServer(server);
    await rm(temp.dir, { recursive: true, force: true });
  }
});

test("authenticated audit viewer uses generic error responses", async () => {
  const temp = await mkdtemp(join(tmpdir(), "codex-relay-audit-bad-"));
  const statePath = join(temp, "state.json");
  await writeFile(statePath, "{", "utf8");
  const password = "correct horse battery staple";
  const config = loadAuditViewerConfig({
    AUDIT_VIEWER_REQUIRE_AUTH: "true",
    AUDIT_VIEWER_PASSWORD: password,
    CODEX_STATE_PATH: statePath
  });
  const { server, baseUrl } = await startTestServer(createAuditViewerServer(config));

  try {
    const response = await fetch(`${baseUrl}/events.json`, {
      headers: { authorization: basicAuth("codex-relay", password) }
    });
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.equal(body.includes(statePath), false);
    assert.equal(body.includes(password), false);
    assert.equal(body, "Audit viewer request failed.\n");
  } finally {
    await closeServer(server);
    await rm(temp, { recursive: true, force: true });
  }
});

test("unauthenticated local audit viewer uses generic error responses", async () => {
  const temp = await mkdtemp(join(tmpdir(), "codex-relay-audit-local-bad-"));
  const statePath = join(temp, "state.json");
  await writeFile(statePath, "{", "utf8");
  const config = loadAuditViewerConfig({ CODEX_STATE_PATH: statePath });
  const { server, baseUrl } = await startTestServer(createAuditViewerServer(config));

  try {
    const response = await fetch(`${baseUrl}/events.json`);
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.equal(body.includes(statePath), false);
    assert.equal(body, "Audit viewer request failed.\n");
  } finally {
    await closeServer(server);
    await rm(temp, { recursive: true, force: true });
  }
});

async function createStateFile(): Promise<{ dir: string; statePath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "codex-relay-audit-"));
  const statePath = join(dir, "state.json");
  const event: AuditEvent = {
    id: "audit-1",
    at: "2026-04-13T00:00:00.000Z",
    type: "authorization.allowed",
    outcome: "success",
    summary: "Allowed task.",
    actorSlackUserId: "U123",
    repoId: "default"
  };
  await writeFile(statePath, JSON.stringify({ auditEvents: [event] }), "utf8");
  return { dir, statePath };
}

async function startTestServer(
  server: Server,
  listenHost = "127.0.0.1",
  requestHost = listenHost
): Promise<{ server: Server; baseUrl: string }> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, listenHost, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  assert(address);
  return { server, baseUrl: `http://${requestHost}:${address.port}` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}
