import { pathToFileURL } from "node:url";
import { loadConfig } from "../../../packages/shared/src/config.js";
import type { EmailNotification } from "../../../packages/shared/src/types.js";
import { createSmtpEmailSender } from "./smtp.js";

export async function sendSmtpSmokeTest(now = new Date()): Promise<EmailNotification> {
  const config = loadConfig(process.env, { requireSlack: false });
  const smtp = config.email?.smtp;

  if (!smtp?.enabled) {
    throw new Error("EMAIL_SMTP_ENABLED=true is required to send a test email.");
  }

  const notification: EmailNotification = {
    id: "local-smtp-smoke",
    kind: "email.test",
    status: "pending",
    severity: "info",
    to: smtp.recipients,
    subject: "Codex Relay SMTP smoke test",
    text: [
      "Codex Relay SMTP smoke test.",
      "",
      "If you received this message, outbound email notification credentials are working.",
      "No task, prompt, diff, token, or local path is included in this smoke test."
    ].join("\n"),
    attempts: 0,
    maxAttempts: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    availableAt: now.toISOString(),
    metadata: {
      source: "smtp-smoke"
    }
  };

  await createSmtpEmailSender(smtp).send(notification);
  return notification;
}

async function main(): Promise<void> {
  const notification = await sendSmtpSmokeTest();
  process.stdout.write(`SMTP smoke email sent to ${notification.to.length} recipient(s).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
