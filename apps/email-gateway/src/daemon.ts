import { pathToFileURL } from "node:url";
import { loadConfig } from "../../../packages/shared/src/config.js";
import { createLogger } from "../../../packages/shared/src/logging.js";
import { loadConfiguredStore } from "../../orchestrator/src/persistence/storeFactory.js";
import { startInboundEmailPoller, pollInboundEmailOnce } from "./inboundPoller.js";
import { publishPendingEmailNotifications, startEmailNotificationPublisher } from "./notificationPublisher.js";
import { assertSmtpConfig, createSmtpEmailSender } from "./smtp.js";

async function main(): Promise<void> {
  const logger = createLogger("email-gateway");
  const config = loadConfig(process.env, { requireSlack: false });
  const smtp = config.email?.smtp;
  const imap = config.email?.imap;

  if (!smtp?.enabled && !imap?.enabled) {
    throw new Error("EMAIL_SMTP_ENABLED=true or EMAIL_IMAP_ENABLED=true is required to start the email gateway.");
  }

  const store = loadConfiguredStore(config);

  if (smtp?.enabled) {
    assertSmtpConfig(smtp);
    const sender = createSmtpEmailSender(smtp);

    logger.info("Email notification publisher started.", {
      storeKind: config.codex.storeKind,
      recipients: smtp.recipients.length
    });

    startEmailNotificationPublisher({
      store,
      sender,
      logger,
      pollIntervalMs: smtp.pollIntervalMs
    });
  }

  if (imap?.enabled) {
    logger.info("Inbound email poller started.", {
      storeKind: config.codex.storeKind,
      mailboxId: config.email?.mailboxId,
      mailbox: imap.mailbox
    });

    startInboundEmailPoller({
      config,
      store,
      logger,
      pollIntervalMs: imap.pollIntervalMs
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export { pollInboundEmailOnce, publishPendingEmailNotifications, startEmailNotificationPublisher, startInboundEmailPoller };
