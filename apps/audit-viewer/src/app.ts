import "dotenv/config";

import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import type { AuditEvent } from "../../../packages/shared/src/types.js";
import type { PersistedState } from "../../orchestrator/src/persistence/stateNormalization.js";

export interface AuditViewerConfig {
  host: string;
  port: number;
  storeKind: "json" | "sqlite";
  statePath: string;
  databasePath: string;
  auth: AuditViewerAuthConfig;
}

interface AuditViewerAuthConfig {
  enabled: boolean;
  username: string;
  password?: string;
}

export interface AuditViewerEnv {
  AUDIT_VIEWER_ALLOW_REMOTE?: string;
  AUDIT_VIEWER_HOST?: string;
  AUDIT_VIEWER_PORT?: string;
  AUDIT_VIEWER_REQUIRE_AUTH?: string;
  AUDIT_VIEWER_USERNAME?: string;
  AUDIT_VIEWER_PASSWORD?: string;
  CODEX_STORE_KIND?: string;
  CODEX_STATE_PATH?: string;
  CODEX_DATABASE_PATH?: string;
}

export function createAuditViewerServer(viewerConfig: AuditViewerConfig): Server {
  return createServer((request, response) => {
    try {
      if (request.url === "/healthz") {
        writeResponse(response, 200, "text/plain; charset=utf-8");
        response.end("ok\n");
        return;
      }

      if (!isAuthorized(request, viewerConfig.auth)) {
        writeUnauthorized(response);
        return;
      }

      if (request.url === "/events.json") {
        const events = loadAuditEvents(viewerConfig).slice(0, 250);
        writeResponse(response, 200, "application/json; charset=utf-8");
        response.end(JSON.stringify({ generatedAt: new Date().toISOString(), count: events.length, events }, null, 2));
        return;
      }

      writeResponse(response, 200, "text/html; charset=utf-8");
      response.end(renderHtml(viewerConfig));
    } catch (error) {
      writeResponse(response, 500, "text/plain; charset=utf-8");
      response.end("Audit viewer request failed.\n");
    }
  });
}

export function loadAuditViewerConfig(env: AuditViewerEnv = process.env): AuditViewerConfig {
  const port = Number.parseInt(env.AUDIT_VIEWER_PORT ?? "1787", 10);
  const host = env.AUDIT_VIEWER_HOST || "127.0.0.1";
  const password = env.AUDIT_VIEWER_PASSWORD?.trim();
  const allowRemote = parseBoolean(env.AUDIT_VIEWER_ALLOW_REMOTE);
  const requireAuth = parseBoolean(env.AUDIT_VIEWER_REQUIRE_AUTH);
  const remoteBind = !isLoopbackHost(host);

  if (remoteBind && !allowRemote) {
    throw new Error("AUDIT_VIEWER_ALLOW_REMOTE=true is required when AUDIT_VIEWER_HOST is non-loopback.");
  }

  if ((remoteBind || allowRemote || requireAuth) && !password) {
    throw new Error("AUDIT_VIEWER_PASSWORD is required when audit viewer remote mode or auth is enabled.");
  }

  if (isPlaceholderSecret(password)) {
    throw new Error("AUDIT_VIEWER_PASSWORD must not use a placeholder value.");
  }

  return {
    host,
    port: Number.isFinite(port) ? port : 1787,
    storeKind: env.CODEX_STORE_KIND === "sqlite" ? "sqlite" : "json",
    statePath: resolve(env.CODEX_STATE_PATH || ".codex-slack/state.json"),
    databasePath: resolve(env.CODEX_DATABASE_PATH || ".codex-slack/state.db"),
    auth: {
      enabled: Boolean(password),
      username: env.AUDIT_VIEWER_USERNAME || "codex-relay",
      password: password || undefined
    }
  };
}

export function loadAuditEvents(viewerConfig: AuditViewerConfig): AuditEvent[] {
  const events =
    viewerConfig.storeKind === "sqlite"
      ? loadSqliteAuditEvents(viewerConfig.databasePath)
      : loadJsonAuditEvents(viewerConfig.statePath);

  return events.sort((a, b) => b.at.localeCompare(a.at));
}

if (isMainModule()) {
  const config = loadAuditViewerConfig();
  const server = createAuditViewerServer(config);

  server.listen(config.port, config.host, () => {
    const authState = config.auth.enabled ? "auth required" : "localhost-only unauthenticated";
    process.stdout.write(`Codex Relay audit viewer listening on http://${config.host}:${config.port} (${authState})\n`);
  });
}

function loadJsonAuditEvents(statePath: string): AuditEvent[] {
  if (!existsSync(statePath)) {
    return [];
  }

  const state = JSON.parse(readFileSync(statePath, "utf8")) as PersistedState;
  return state.auditEvents ?? [];
}

function loadSqliteAuditEvents(databasePath: string): AuditEvent[] {
  if (!existsSync(databasePath)) {
    return [];
  }

  const db = new Database(databasePath, { readonly: true, fileMustExist: true });

  try {
    const exists = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_events'")
      .get();

    if (!exists) {
      return [];
    }

    const rows = db.prepare("SELECT data FROM audit_events ORDER BY at DESC LIMIT 250").all() as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as AuditEvent);
  } finally {
    db.close();
  }
}

function renderHtml(viewerConfig: AuditViewerConfig): string {
  const stateTarget = viewerConfig.storeKind === "sqlite" ? "Store: SQLite" : "Store: JSON";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Relay Audit</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #07111f;
      --panel: #0d1c31;
      --panel-2: #10243d;
      --text: #e8f3ff;
      --muted: #91a9c8;
      --line: #25405f;
      --cyan: #47d9ff;
      --blue: #6ca7ff;
      --violet: #9d7cff;
      --green: #67e8a5;
      --yellow: #ffd166;
      --red: #ff6b7a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 20% 0%, rgba(71, 217, 255, 0.16), transparent 30%),
        linear-gradient(135deg, #07111f 0%, #09182b 45%, #0b1020 100%);
      color: var(--text);
      font: 15px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main { width: min(1180px, calc(100vw - 40px)); margin: 0 auto; padding: 42px 0; }
    header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-end; margin-bottom: 28px; }
    h1 { margin: 0; font-size: clamp(32px, 5vw, 54px); letter-spacing: 0; }
    .subtitle { color: var(--muted); max-width: 680px; margin: 10px 0 0; }
    .badge { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; color: var(--muted); background: rgba(13, 28, 49, 0.72); white-space: nowrap; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
    .stat, .toolbar, .event { border: 1px solid var(--line); background: rgba(13, 28, 49, 0.84); border-radius: 8px; }
    .stat { padding: 16px; }
    .stat strong { display: block; font-size: 28px; }
    .stat span { color: var(--muted); }
    .toolbar { display: flex; gap: 12px; align-items: center; padding: 12px; margin-bottom: 14px; }
    input, select {
      width: 100%;
      border: 1px solid var(--line);
      background: #071426;
      color: var(--text);
      border-radius: 6px;
      padding: 10px 12px;
      font: inherit;
    }
    select { max-width: 190px; }
    .timeline { display: grid; gap: 10px; }
    .event { display: grid; grid-template-columns: 150px 120px 1fr; gap: 14px; padding: 14px; align-items: start; }
    .time { color: var(--muted); font-variant-numeric: tabular-nums; }
    .pill { display: inline-flex; justify-content: center; border-radius: 999px; padding: 4px 9px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .success { background: rgba(103, 232, 165, 0.16); color: var(--green); }
    .failure { background: rgba(255, 107, 122, 0.16); color: var(--red); }
    .denied { background: rgba(255, 209, 102, 0.16); color: var(--yellow); }
    .info { background: rgba(108, 167, 255, 0.16); color: var(--blue); }
    .event h2 { margin: 0; font-size: 16px; }
    .summary { margin: 4px 0 0; color: var(--muted); }
    .meta { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { border: 1px solid var(--line); background: var(--panel-2); color: #c7ddf6; border-radius: 999px; padding: 3px 8px; font-size: 12px; }
    .empty { color: var(--muted); padding: 28px; text-align: center; border: 1px dashed var(--line); border-radius: 8px; }
    @media (max-width: 820px) {
      main { width: min(100vw - 24px, 1180px); padding: 24px 0; }
      header { display: block; }
      .badge { margin-top: 16px; white-space: normal; }
      .stats { grid-template-columns: repeat(2, 1fr); }
      .toolbar { display: grid; }
      select { max-width: none; }
      .event { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Codex Relay Audit</h1>
        <p class="subtitle">Human-readable timeline for Slack approvals, authorization denials, worktree execution, cleanup, and PR handoff.</p>
      </div>
      <div class="badge">${stateTarget}</div>
    </header>
    <section class="stats" aria-label="Audit totals">
      <div class="stat"><strong id="total">0</strong><span>Total events</span></div>
      <div class="stat"><strong id="denied">0</strong><span>Denied</span></div>
      <div class="stat"><strong id="success">0</strong><span>Success</span></div>
      <div class="stat"><strong id="failure">0</strong><span>Failure</span></div>
    </section>
    <section class="toolbar" aria-label="Filters">
      <input id="search" type="search" placeholder="Filter by repo, session, type, actor, or summary">
      <select id="outcome">
        <option value="">All outcomes</option>
        <option value="success">Success</option>
        <option value="denied">Denied</option>
        <option value="failure">Failure</option>
        <option value="info">Info</option>
      </select>
    </section>
    <section id="timeline" class="timeline" aria-live="polite"></section>
  </main>
  <script>
    const state = { events: [] };
    const timeline = document.querySelector("#timeline");
    const search = document.querySelector("#search");
    const outcome = document.querySelector("#outcome");

    fetch("/events.json")
      .then((response) => response.json())
      .then((data) => {
        state.events = data.events || [];
        render();
      })
      .catch((error) => {
        timeline.innerHTML = '<div class="empty">Could not load audit events: ' + escapeHtml(String(error)) + '</div>';
      });

    search.addEventListener("input", render);
    outcome.addEventListener("change", render);

    function render() {
      const query = search.value.trim().toLowerCase();
      const selectedOutcome = outcome.value;
      const events = state.events.filter((event) => {
        const haystack = [
          event.type,
          event.outcome,
          event.summary,
          event.actorSlackUserId,
          event.repoId,
          event.sessionId,
          event.approvalId,
          event.taskRunId
        ].filter(Boolean).join(" ").toLowerCase();
        return (!selectedOutcome || event.outcome === selectedOutcome) && (!query || haystack.includes(query));
      });

      document.querySelector("#total").textContent = String(state.events.length);
      document.querySelector("#denied").textContent = String(state.events.filter((event) => event.outcome === "denied").length);
      document.querySelector("#success").textContent = String(state.events.filter((event) => event.outcome === "success").length);
      document.querySelector("#failure").textContent = String(state.events.filter((event) => event.outcome === "failure").length);

      timeline.innerHTML = events.length ? events.map(renderEvent).join("") : '<div class="empty">No matching audit events.</div>';
    }

    function renderEvent(event) {
      const meta = [
        event.repoId && ['repo', event.repoId],
        event.actorSlackUserId && ['actor', event.actorSlackUserId],
        event.sessionId && ['session', event.sessionId],
        event.taskRunId && ['run', event.taskRunId],
        event.approvalId && ['approval', event.approvalId]
      ].filter(Boolean);
      return '<article class="event">' +
        '<div class="time">' + escapeHtml(formatTime(event.at)) + '</div>' +
        '<div><span class="pill ' + escapeHtml(event.outcome) + '">' + escapeHtml(event.outcome) + '</span></div>' +
        '<div><h2>' + escapeHtml(event.type) + '</h2>' +
        '<p class="summary">' + escapeHtml(event.summary) + '</p>' +
        '<div class="meta">' + meta.map(([key, value]) => '<span class="chip">' + escapeHtml(key) + ': ' + escapeHtml(value) + '</span>').join("") + '</div></div>' +
        '</article>';
    }

    function formatTime(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[char]);
    }
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return replacements[char] ?? char;
  });
}

function isAuthorized(request: IncomingMessage, auth: AuditViewerAuthConfig): boolean {
  if (!auth.enabled) {
    return true;
  }

  const header = request.headers.authorization;

  const match = /^basic\s+(.+)$/iu.exec(header ?? "");

  if (!match) {
    return false;
  }

  const decoded = decodeBasicAuth(match[1] ?? "");

  if (!decoded) {
    return false;
  }

  return secureStringEquals(decoded.username, auth.username) && secureStringEquals(decoded.password, auth.password ?? "");
}

function decodeBasicAuth(encoded: string): { username: string; password: string } | undefined {
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");

    if (separator < 0) {
      return undefined;
    }

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return undefined;
  }
}

function writeUnauthorized(response: ServerResponse): void {
  response.writeHead(401, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "www-authenticate": 'Basic realm="Codex Relay Audit", charset="UTF-8"'
  });
  response.end("Authentication required.\n");
}

function writeResponse(response: ServerResponse, statusCode: number, contentType: string): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  });
}

function parseBoolean(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/iu.test(value?.trim() ?? "");
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.*)\]$/u, "$1");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1"
  );
}

function isPlaceholderSecret(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return /^(password|changeme|change-me|change_me|secret|token|example|your-password)$/iu.test(value.trim());
}

function secureStringEquals(left: string, right: string): boolean {
  return timingSafeEqual(hashString(left), hashString(right));
}

function hashString(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function isMainModule(): boolean {
  return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
}
