#!/usr/bin/env node
const args = parseArgs(process.argv.slice(2));

if (args.help || !args.text) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

const token = process.env.SLACK_SMOKE_TOKEN;
const channel = process.env.SLACK_SMOKE_CHANNEL_ID;
const botUserId = process.env.SLACK_SMOKE_BOT_USER_ID;

if (!token || !channel || !botUserId) {
  console.error(
    "SLACK_SMOKE_TOKEN, SLACK_SMOKE_CHANNEL_ID, and SLACK_SMOKE_BOT_USER_ID are required in the local environment."
  );
  process.exit(1);
}

const text = `<@${botUserId}> ${args.text}`;
const post = await slackApi("chat.postMessage", {
  channel,
  text,
  thread_ts: args.threadTs
});

if (!post.ok) {
  console.log(JSON.stringify({ ok: false, stage: "post", error: sanitize(post.error ?? "unknown") }));
  process.exit(1);
}

const threadTs = args.threadTs ?? post.ts;
const waitSeconds = Number.parseInt(args.waitSeconds ?? "90", 10);
const expected = args.expect?.toLowerCase();
const deadline = Date.now() + waitSeconds * 1000;
let matchedReply;
let replyCount = 0;

while (Date.now() < deadline) {
  await sleep(3000);
  const replies = await slackApi("conversations.replies", {
    channel,
    ts: threadTs,
    limit: 20
  });

  if (!replies.ok) {
    console.log(JSON.stringify({ ok: false, stage: "poll", error: sanitize(replies.error ?? "unknown") }));
    process.exit(1);
  }

  const messages = replies.messages ?? [];
  replyCount = Math.max(0, messages.length - 1);
  matchedReply = messages.find((message) => {
    if (message.ts === post.ts) {
      return false;
    }

    const candidate = String(message.text ?? "").toLowerCase();
    return expected ? candidate.includes(expected) : true;
  });

  if (matchedReply) {
    break;
  }
}

console.log(JSON.stringify({
  ok: Boolean(matchedReply),
  posted: true,
  replyFound: Boolean(matchedReply),
  replyCount,
  threadTsSet: Boolean(threadTs),
  matchedText: matchedReply ? sanitize(String(matchedReply.text ?? ""), 300) : undefined
}));

process.exit(matchedReply ? 0 : 2);

async function slackApi(method, body) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(body)
  });

  return response.json();
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--text") {
      parsed.text = argv[++index];
      continue;
    }

    if (arg === "--thread-ts") {
      parsed.threadTs = argv[++index];
      continue;
    }

    if (arg === "--expect") {
      parsed.expect = argv[++index];
      continue;
    }

    if (arg === "--wait-seconds") {
      parsed.waitSeconds = argv[++index];
      continue;
    }
  }

  return parsed;
}

function printUsage() {
  console.log(`Usage:
  npm run smoke:slack -- --text "ask repo:default what is the package name in package.json?" --expect "Answer"

Required local env:
  SLACK_SMOKE_TOKEN       Dedicated local test user token or bot-like account token
  SLACK_SMOKE_CHANNEL_ID  Private test channel ID
  SLACK_SMOKE_BOT_USER_ID Codex Relay app/bot user ID to mention

Optional:
  --thread-ts <ts>        Post as a reply in an existing Slack thread
  --wait-seconds <n>      Poll timeout, default 90
`);
}

function sanitize(value, maxLength = 500) {
  return value
    .replace(/xox[a-z]-[A-Za-z0-9-]+/gu, "<token>")
    .replace(/\b[UTC][A-Z0-9]{8,}\b/gu, "<slack-id>")
    .replace(/[A-Za-z]:\\[^\r\n`"]+/gu, "<path>")
    .slice(0, maxLength);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
