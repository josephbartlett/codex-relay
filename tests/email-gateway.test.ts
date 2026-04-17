import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorizeEmailSender } from "../packages/shared/src/authorization.js";
import { loadConfig } from "../packages/shared/src/config.js";
import {
  extractEmailRepoId,
  normalizeEmailCommandText,
  parseInboundEmailCommand
} from "../apps/email-gateway/src/commands.js";
import type { InboundEmailMessage } from "../apps/email-gateway/src/commands.js";
import { pollInboundEmailOnce } from "../apps/email-gateway/src/inboundPoller.js";
import type { EmailMailboxClient, MailboxMessageRef } from "../apps/email-gateway/src/imap.js";
import { processInboundEmailMessage } from "../apps/email-gateway/src/tasks.js";
import { InMemoryStore } from "../apps/orchestrator/src/persistence/inMemory.js";

const baseEnv = {
  CODEX_ALLOWED_REPOS: "default=/tmp/default,api=/tmp/api",
  CODEX_DEFAULT_REPO_ID: "default",
  CODEX_POLICY_MODE: "local-dev"
};

test("email control plane config is disabled by default", () => {
  const config = loadConfig(baseEnv, { requireSlack: false });

  assert.equal(config.email?.enabled, false);
  assert.deepEqual(config.email?.allowedSenders, []);
  assert.equal(config.email?.smtp.enabled, false);
  assert.equal(config.email?.smtp.tlsRejectUnauthorized, true);
  assert.deepEqual(config.email?.smtp.recipients, []);
  assert.equal(authorizeEmailSender(config, "operator@example.test").ok, false);
});

test("email SMTP config is explicit and validates enabled requirements", () => {
  const config = loadConfig(
    {
      ...baseEnv,
      EMAIL_SMTP_ENABLED: "true",
      EMAIL_SMTP_HOST: "smtp.example.test",
      EMAIL_SMTP_PORT: "587",
      EMAIL_SMTP_SECURE: "false",
      EMAIL_SMTP_TLS_REJECT_UNAUTHORIZED: "false",
      EMAIL_SMTP_USER: "relay@example.test",
      EMAIL_SMTP_PASSWORD: "local-test-password",
      EMAIL_FROM: "Codex Relay <relay@example.test>",
      EMAIL_TO: "operator@example.test; second@example.test"
    },
    { requireSlack: false }
  );

  assert.equal(config.email?.smtp.enabled, true);
  assert.equal(config.email?.smtp.host, "smtp.example.test");
  assert.equal(config.email?.smtp.port, 587);
  assert.equal(config.email?.smtp.tlsRejectUnauthorized, false);
  assert.deepEqual(config.email?.smtp.recipients, ["operator@example.test", "second@example.test"]);

  assert.throws(
    () => loadConfig({ ...baseEnv, EMAIL_SMTP_ENABLED: "true", EMAIL_FROM: "relay@example.test" }, { requireSlack: false }),
    /EMAIL_SMTP_HOST/u
  );
});

test("email IMAP config is explicit and validates enabled requirements", () => {
  const config = loadConfig(
    {
      ...baseEnv,
      EMAIL_CONTROL_PLANE_ENABLED: "true",
      EMAIL_ALLOWED_SENDERS: "operator@example.test",
      EMAIL_IMAP_ENABLED: "true",
      EMAIL_IMAP_HOST: "imap.example.test",
      EMAIL_IMAP_PORT: "993",
      EMAIL_IMAP_SECURE: "true",
      EMAIL_IMAP_TLS_REJECT_UNAUTHORIZED: "false",
      EMAIL_IMAP_USER: "relay@example.test",
      EMAIL_IMAP_PASSWORD: "local-test-password",
      EMAIL_IMAP_MAILBOX: "Codex",
      EMAIL_IMAP_POLL_MS: "5000",
      EMAIL_IMAP_MAX_MESSAGES: "7",
      EMAIL_IMAP_MAX_BYTES: "120000",
      EMAIL_IMAP_MARK_SEEN: "true"
    },
    { requireSlack: false }
  );

  assert.equal(config.email?.imap.enabled, true);
  assert.equal(config.email?.imap.host, "imap.example.test");
  assert.equal(config.email?.imap.mailbox, "Codex");
  assert.equal(config.email?.imap.tlsRejectUnauthorized, false);
  assert.equal(config.email?.imap.maxMessages, 7);
  assert.equal(config.email?.imap.maxBytes, 120000);
  assert.equal(config.email?.imap.markSeen, true);

  assert.throws(
    () => loadConfig({ ...baseEnv, EMAIL_IMAP_ENABLED: "true", EMAIL_IMAP_HOST: "imap.example.test" }, { requireSlack: false }),
    /EMAIL_CONTROL_PLANE_ENABLED/u
  );
});

test("direct workspace config is disabled by default and repo-scoped", () => {
  const disabled = loadConfig(baseEnv, { requireSlack: false });

  assert.equal(disabled.codex.directWorkspace.enabled, false);
  assert.equal(disabled.email?.directWorkspaceEnabled, false);

  const enabled = loadConfig(
    {
      ...baseEnv,
      CODEX_DIRECT_WORKSPACE_ENABLED: "true",
      CODEX_DIRECT_WORKSPACE_ALLOWED_REPOS: "default;api",
      CODEX_DIRECT_WORKSPACE_REQUIRE_CLEAN: "false",
      EMAIL_DIRECT_WORKSPACE_ENABLED: "true"
    },
    { requireSlack: false }
  );

  assert.equal(enabled.codex.directWorkspace.enabled, true);
  assert.deepEqual(enabled.codex.directWorkspace.allowedRepoIds, ["default", "api"]);
  assert.equal(enabled.codex.directWorkspace.requireClean, false);
  assert.equal(enabled.email?.directWorkspaceEnabled, true);

  assert.throws(
    () => loadConfig({ ...baseEnv, CODEX_DIRECT_WORKSPACE_ENABLED: "true" }, { requireSlack: false }),
    /CODEX_DIRECT_WORKSPACE_ALLOWED_REPOS/u
  );
  assert.throws(
    () => loadConfig({ ...baseEnv, EMAIL_DIRECT_WORKSPACE_ENABLED: "true" }, { requireSlack: false }),
    /CODEX_DIRECT_WORKSPACE_ENABLED/u
  );
});

test("email sender authorization is explicit and normalized", () => {
  const config = loadConfig(
    {
      ...baseEnv,
      EMAIL_CONTROL_PLANE_ENABLED: "true",
      EMAIL_ALLOWED_SENDERS: "Operator@Example.Test, Other <other@example.test>"
    },
    { requireSlack: false }
  );

  assert.deepEqual(config.email?.allowedSenders, ["operator@example.test", "other@example.test"]);
  assert.equal(authorizeEmailSender(config, "operator@example.test").ok, true);
  assert.equal(authorizeEmailSender(config, "Other <other@example.test>").ok, true);
  assert.equal(authorizeEmailSender(config, "blocked@example.test").ok, false);
});

test("email command parser accepts allowlisted read-only task requests", () => {
  const config = loadConfig(
    {
      ...baseEnv,
      EMAIL_CONTROL_PLANE_ENABLED: "true",
      EMAIL_ALLOWED_SENDERS: "operator@example.test"
    },
    { requireSlack: false }
  );

  const command = parseInboundEmailCommand(config, {
    messageId: "message-1",
    threadId: "thread-1",
    from: "Operator <operator@example.test>",
    subject: "Codex Relay: repo:api inspect failing tests",
    text: "Please inspect the failing parser tests and propose a plan.\n\n> old quoted content"
  });

  assert.equal(command.kind, "start_plan");

  if (command.kind === "start_plan") {
    assert.equal(command.sender, "operator@example.test");
    assert.equal(command.repoId, "api");
    assert.equal(command.threadId, "thread-1");
    assert.match(command.prompt, /inspect failing tests/u);
    assert.doesNotMatch(command.prompt, /old quoted content/u);
  }
});

test("email command parser accepts ask mode and gates direct workspace mode", () => {
  const askConfig = loadConfig(
    {
      ...baseEnv,
      EMAIL_CONTROL_PLANE_ENABLED: "true",
      EMAIL_ALLOWED_SENDERS: "operator@example.test"
    },
    { requireSlack: false }
  );

  const ask = parseInboundEmailCommand(askConfig, {
    messageId: "message-ask",
    from: "operator@example.test",
    subject: "repo:api ask which file builds Table 3?"
  });

  assert.equal(ask.kind, "start_ask");
  if (ask.kind === "start_ask") {
    assert.equal(ask.repoId, "api");
    assert.equal(ask.prompt, "which file builds Table 3?");
  }

  const replyAsk = parseInboundEmailCommand(askConfig, {
    messageId: "message-reply-ask",
    from: "operator@example.test",
    subject: "Re: Codex Relay completed: api [relay:abc123def456]",
    text: "ask what files did you inspect?"
  });

  assert.equal(replyAsk.kind, "start_ask");
  if (replyAsk.kind === "start_ask") {
    assert.equal(replyAsk.replySessionId, "abc123def456");
    assert.equal(replyAsk.prompt, "what files did you inspect?");
  }

  const replyAskAfterRelayMetadata = parseInboundEmailCommand(askConfig, {
    messageId: "message-reply-ask-metadata",
    from: "operator@example.test",
    subject: "Re: Codex Relay queued: default [relay:abc123def456]",
    text: [
      "Codex Relay queued your read-only plan request.",
      "",
      "Repo: default",
      "Workspace: codex/email/example",
      "Session: abc123def456",
      "Reply reference: relay:abc123def456",
      "Queue job: queue123",
      "",
      "ask what files did you inspect?"
    ].join("\n")
  });

  assert.equal(replyAskAfterRelayMetadata.kind, "start_ask");
  if (replyAskAfterRelayMetadata.kind === "start_ask") {
    assert.equal(replyAskAfterRelayMetadata.replySessionId, "abc123def456");
    assert.equal(replyAskAfterRelayMetadata.prompt, "what files did you inspect?");
  }

  const askWithGenericSubject = parseInboundEmailCommand(askConfig, {
    messageId: "message-ask-body",
    from: "operator@example.test",
    subject: "Codex Relay",
    text: "ask repo:default what is the package name in package.json?"
  });

  assert.equal(askWithGenericSubject.kind, "start_ask");
  if (askWithGenericSubject.kind === "start_ask") {
    assert.equal(askWithGenericSubject.repoId, "default");
    assert.equal(askWithGenericSubject.prompt, "what is the package name in package.json?");
  }

  const generatedQueuedNotification = parseInboundEmailCommand(askConfig, {
    messageId: "message-generated-queued",
    from: "operator@example.test",
    subject: "Codex Relay queued: default [relay:abc123def456]",
    text: [
      "Codex Relay queued your read-only plan request.",
      "",
      "Repo: default",
      "Workspace: codex/email/example",
      "Session: abc123def456",
      "Reply reference: relay:abc123def456",
      "Queue job: queue123",
      "",
      "Email approvals are disabled. You will receive a compact plan-ready reply when the runner finishes."
    ].join("\n")
  });

  assert.deepEqual(generatedQueuedNotification, {
    kind: "ignored",
    messageId: "message-generated-queued",
    reason: "unsupported"
  });

  const directConfig = loadConfig(
    {
      ...baseEnv,
      EMAIL_CONTROL_PLANE_ENABLED: "true",
      EMAIL_ALLOWED_SENDERS: "operator@example.test",
      CODEX_DIRECT_WORKSPACE_ENABLED: "true",
      CODEX_DIRECT_WORKSPACE_ALLOWED_REPOS: "api",
      EMAIL_DIRECT_WORKSPACE_ENABLED: "true"
    },
    { requireSlack: false }
  );
  const generatedDirectQueuedNotification = parseInboundEmailCommand(directConfig, {
    messageId: "message-generated-direct-queued",
    from: "operator@example.test",
    subject: "Codex Relay queued: api [relay:abc123def456]",
    text: [
      "Codex Relay queued your direct workspace request.",
      "",
      "Repo: api",
      "Workspace: source working tree",
      "Session: abc123def456",
      "Reply reference: relay:abc123def456",
      "Queue job: queue123",
      "",
      "Direct workspace mode edits the source working tree. You will receive a compact completion reply."
    ].join("\n")
  });

  assert.deepEqual(generatedDirectQueuedNotification, {
    kind: "ignored",
    messageId: "message-generated-direct-queued",
    reason: "unsupported"
  });

  const generatedSmtpSmoke = parseInboundEmailCommand(askConfig, {
    messageId: "message-generated-smoke",
    from: "operator@example.test",
    subject: "Codex Relay SMTP smoke test",
    text: "Codex Relay SMTP smoke test."
  });

  assert.deepEqual(generatedSmtpSmoke, {
    kind: "ignored",
    messageId: "message-generated-smoke",
    reason: "unsupported"
  });

  assert.deepEqual(
    parseInboundEmailCommand(askConfig, {
      messageId: "message-direct-disabled",
      from: "operator@example.test",
      subject: "repo:api quick update README"
    }),
    {
      kind: "rejected",
      messageId: "message-direct-disabled",
      reason: "direct_workspace_not_enabled"
    }
  );

  const direct = parseInboundEmailCommand(directConfig, {
    messageId: "message-direct",
    from: "operator@example.test",
    subject: "repo:api direct update README"
  });

  assert.equal(direct.kind, "start_direct");
  if (direct.kind === "start_direct") {
    assert.equal(direct.prompt, "update README");
  }
});

test("email command parser rejects write approval replies", () => {
  const config = loadConfig(
    {
      ...baseEnv,
      EMAIL_CONTROL_PLANE_ENABLED: "true",
      EMAIL_ALLOWED_SENDERS: "operator@example.test"
    },
    { requireSlack: false }
  );

  const command = parseInboundEmailCommand(config, {
    messageId: "message-2",
    from: "operator@example.test",
    subject: "approve execution",
    text: "Approved, execute the plan."
  });

  assert.deepEqual(command, {
    kind: "rejected",
    messageId: "message-2",
    reason: "write_approval_not_supported"
  });
});

test("email command parser rejects denied senders and unknown repos", () => {
  const config = loadConfig(
    {
      ...baseEnv,
      EMAIL_CONTROL_PLANE_ENABLED: "true",
      EMAIL_ALLOWED_SENDERS: "operator@example.test"
    },
    { requireSlack: false }
  );

  assert.deepEqual(parseInboundEmailCommand(config, {
    messageId: "message-3",
    from: "blocked@example.test",
    subject: "repo:api inspect this"
  }), {
    kind: "rejected",
    messageId: "message-3",
    reason: "sender_not_allowed"
  });

  assert.deepEqual(parseInboundEmailCommand(config, {
    messageId: "message-4",
    from: "operator@example.test",
    subject: "repo:missing inspect this"
  }), {
    kind: "rejected",
    messageId: "message-4",
    reason: "repo_not_configured"
  });
});

test("email text normalization strips common quoted headers", () => {
  const normalized = normalizeEmailCommandText([
    "repo:api inspect auth flow",
    "",
    "On Tue, Person wrote:",
    "> previous message",
    "From: person@example.test",
    "Subject: old subject"
  ].join("\n"));

  assert.equal(normalized, "repo:api inspect auth flow");
  assert.equal(extractEmailRepoId(normalized), "api");
});

test("inbound email intake enqueues a read-only plan task once", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-email-intake-"));

  try {
    const repo = createGitRepo(join(temp, "repo"));
    const config = loadConfig(
      {
        ...baseEnv,
        CODEX_ALLOWED_REPOS: `default=${repo}`,
        CODEX_WORKTREE_ROOT: join(temp, "worktrees"),
        EMAIL_CONTROL_PLANE_ENABLED: "true",
        EMAIL_ALLOWED_SENDERS: "operator@example.test",
        EMAIL_SMTP_ENABLED: "true",
        EMAIL_SMTP_HOST: "smtp.example.test",
        EMAIL_FROM: "Codex Relay <relay@example.test>",
        EMAIL_TO: "operator@example.test"
      },
      { requireSlack: false }
    );
    const store = new InMemoryStore();

    const first = await processInboundEmailMessage({
      config,
      store,
      message: {
        messageId: "<message-1@example.test>",
        threadId: "<thread-1@example.test>",
        from: "Operator <operator@example.test>",
        subject: "repo:default inspect package scripts",
        text: "Please inspect package scripts and propose a plan."
      },
      now: new Date("2026-04-16T12:00:00.000Z")
    });
    const second = await processInboundEmailMessage({
      config,
      store,
      message: {
        messageId: "<message-1@example.test>",
        threadId: "<thread-1@example.test>",
        from: "Operator <operator@example.test>",
        subject: "repo:default inspect package scripts",
        text: "Please inspect package scripts and propose a plan."
      },
      now: new Date("2026-04-16T12:01:00.000Z")
    });

    assert.equal(first.kind, "queued");
    assert.equal(second.kind, "duplicate");
    assert.equal(store.listQueueJobs().length, 1);
    assert.equal(store.listEmailInboundMessages().length, 1);
    assert.equal(store.listSlackNotifications().length, 0);
    assert.equal(store.listEmailNotifications().length, 1);

    if (first.kind === "queued") {
      assert.equal(first.session.controlPlane, "email");
      assert.equal(first.session.email?.sender, "operator@example.test");
      assert.equal(first.taskRun.mode, "plan");
      assert.equal(first.taskRun.sandbox, "read-only");
      assert.match(first.taskRun.prompt, /email plan phase/u);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("inbound email replies can resume an existing email session by relay marker", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-email-reply-"));

  try {
    const repo = createGitRepo(join(temp, "repo"));
    const config = loadConfig(
      {
        ...baseEnv,
        CODEX_ALLOWED_REPOS: `default=${repo}`,
        CODEX_WORKTREE_ROOT: join(temp, "worktrees"),
        EMAIL_CONTROL_PLANE_ENABLED: "true",
        EMAIL_ALLOWED_SENDERS: "operator@example.test",
        EMAIL_SMTP_ENABLED: "true",
        EMAIL_SMTP_HOST: "smtp.example.test",
        EMAIL_FROM: "Codex Relay <relay@example.test>",
        EMAIL_TO: "operator@example.test"
      },
      { requireSlack: false }
    );
    const store = new InMemoryStore();

    const first = await processInboundEmailMessage({
      config,
      store,
      message: {
        messageId: "<message-root@example.test>",
        threadId: "<thread-root@example.test>",
        from: "operator@example.test",
        subject: "repo:default inspect scripts",
        text: "Please propose a plan."
      },
      now: new Date("2026-04-16T12:00:00.000Z")
    });

    assert.equal(first.kind, "queued");
    if (first.kind !== "queued") {
      throw new Error("Expected first email command to queue.");
    }

    store.queueJobs.clear();

    const reply = await processInboundEmailMessage({
      config,
      store,
      message: {
        messageId: "<message-reply@example.test>",
        threadId: "<message-outbound@example.test>",
        from: "operator@example.test",
        subject: `Re: Codex Relay completed [relay:${first.session.id}]`,
        text: "ask which file has package scripts?"
      },
      now: new Date("2026-04-16T12:05:00.000Z")
    });

    assert.equal(reply.kind, "queued");
    if (reply.kind !== "queued") {
      throw new Error("Expected reply email command to queue.");
    }

    assert.equal(reply.session.id, first.session.id);
    assert.equal(reply.session.workspaceKind, "worktree");
    assert.equal(reply.taskRun.mode, "explain");
    assert.match(reply.taskRun.prompt, /email ask mode/u);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("inbound email intake supports ask and gated direct workspace tasks", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-email-modes-"));

  try {
    const repo = createGitRepo(join(temp, "repo"));
    const config = loadConfig(
      {
        ...baseEnv,
        CODEX_ALLOWED_REPOS: `default=${repo}`,
        CODEX_WORKTREE_ROOT: join(temp, "worktrees"),
        CODEX_DIRECT_WORKSPACE_ENABLED: "true",
        CODEX_DIRECT_WORKSPACE_ALLOWED_REPOS: "default",
        EMAIL_CONTROL_PLANE_ENABLED: "true",
        EMAIL_ALLOWED_SENDERS: "operator@example.test",
        EMAIL_DIRECT_WORKSPACE_ENABLED: "true",
        EMAIL_SMTP_ENABLED: "true",
        EMAIL_SMTP_HOST: "smtp.example.test",
        EMAIL_FROM: "Codex Relay <relay@example.test>",
        EMAIL_TO: "operator@example.test"
      },
      { requireSlack: false }
    );
    const store = new InMemoryStore();

    const ask = await processInboundEmailMessage({
      config,
      store,
      message: {
        messageId: "<message-ask@example.test>",
        threadId: "<thread-ask@example.test>",
        from: "operator@example.test",
        subject: "repo:default ask which file defines scripts?",
        text: ""
      },
      now: new Date("2026-04-16T12:00:00.000Z")
    });
    const direct = await processInboundEmailMessage({
      config,
      store,
      message: {
        messageId: "<message-direct@example.test>",
        threadId: "<thread-direct@example.test>",
        from: "operator@example.test",
        subject: "repo:default quick update README title",
        text: ""
      },
      now: new Date("2026-04-16T12:01:00.000Z")
    });

    assert.equal(ask.kind, "queued");
    assert.equal(direct.kind, "queued");

    if (ask.kind === "queued") {
      assert.equal(ask.session.workspaceKind, "source");
      assert.equal(ask.session.workspacePath, repo);
      assert.equal(ask.taskRun.mode, "explain");
      assert.equal(ask.taskRun.sandbox, "read-only");
      assert.match(ask.taskRun.prompt, /email ask mode/u);
    }

    if (direct.kind === "queued") {
      assert.equal(direct.session.workspaceKind, "source");
      assert.equal(direct.session.workspacePath, repo);
      assert.equal(direct.taskRun.mode, "implement");
      assert.equal(direct.taskRun.sandbox, "workspace-write");
      assert.match(direct.taskRun.prompt, /email direct workspace mode/u);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("inbound email intake does not reply to unauthorized senders", async () => {
  const config = loadConfig(
    {
      ...baseEnv,
      EMAIL_CONTROL_PLANE_ENABLED: "true",
      EMAIL_ALLOWED_SENDERS: "operator@example.test",
      EMAIL_SMTP_ENABLED: "true",
      EMAIL_SMTP_HOST: "smtp.example.test",
      EMAIL_FROM: "Codex Relay <relay@example.test>",
      EMAIL_TO: "operator@example.test"
    },
    { requireSlack: false }
  );
  const store = new InMemoryStore();

  const result = await processInboundEmailMessage({
    config,
    store,
    message: {
      messageId: "<message-blocked@example.test>",
      from: "blocked@example.test",
      subject: "repo:default inspect package scripts",
      text: "Please inspect package scripts."
    },
    now: new Date("2026-04-16T12:00:00.000Z")
  });

  assert.equal(result.kind, "rejected");
  assert.equal(store.listEmailNotifications().length, 0);
  assert.equal(store.listQueueJobs().length, 0);
});

test("inbound email poller processes mailbox messages and can mark them seen", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-email-poller-"));

  try {
    const repo = createGitRepo(join(temp, "repo"));
    const config = loadConfig(
      {
        ...baseEnv,
        CODEX_ALLOWED_REPOS: `default=${repo}`,
        CODEX_WORKTREE_ROOT: join(temp, "worktrees"),
        EMAIL_CONTROL_PLANE_ENABLED: "true",
        EMAIL_ALLOWED_SENDERS: "operator@example.test",
        EMAIL_IMAP_ENABLED: "true",
        EMAIL_IMAP_HOST: "imap.example.test",
        EMAIL_IMAP_USER: "relay@example.test",
        EMAIL_IMAP_PASSWORD: "local-test-password",
        EMAIL_IMAP_MARK_SEEN: "true"
      },
      { requireSlack: false }
    );
    const store = new InMemoryStore();
    const mailbox = new FakeMailboxClient([
      {
        uid: 42,
        messageId: "<message-2@example.test>",
        from: "operator@example.test",
        subject: "repo:default inspect README",
        text: "Inspect the README and propose a plan."
      }
    ]);

    const result = await pollInboundEmailOnce({
      config,
      store,
      mailboxFactory: async () => mailbox,
      now: () => new Date("2026-04-16T12:00:00.000Z")
    });

    assert.deepEqual(result, {
      fetched: 1,
      queued: 1,
      rejected: 0,
      ignored: 0,
      failed: 0,
      duplicates: 0,
      markedProcessed: 1
    });
    assert.deepEqual(mailbox.marked, [{ uid: 42, messageId: "<message-2@example.test>" }]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

class FakeMailboxClient implements EmailMailboxClient {
  readonly marked: MailboxMessageRef[] = [];

  constructor(private readonly messages: Array<InboundEmailMessage & MailboxMessageRef>) {}

  async fetchUnread(maxMessages: number): Promise<Array<InboundEmailMessage & MailboxMessageRef>> {
    return this.messages.slice(0, maxMessages);
  }

  async markProcessed(message: MailboxMessageRef): Promise<void> {
    this.marked.push(message);
  }

  async close(): Promise<void> {}
}

function createGitRepo(path: string): string {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "README.md"), "# Test repo\n", "utf8");
  execFileSync("git", ["init"], { cwd: path, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.test"], { cwd: path, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: path, stdio: "ignore" });
  execFileSync("git", ["add", "README.md"], { cwd: path, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: path, stdio: "ignore" });
  return path;
}
