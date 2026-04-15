import { pathToFileURL } from "node:url";
import { loadConfig } from "../../../packages/shared/src/config.js";
import { createLogger } from "../../../packages/shared/src/logging.js";
import { loadConfiguredStore } from "../../orchestrator/src/persistence/storeFactory.js";
import { pollInboundEmailOnce } from "./inboundPoller.js";
import { publishPendingEmailNotifications } from "./notificationPublisher.js";
import { assertSmtpConfig, createSmtpEmailSender } from "./smtp.js";

async function main(): Promise<void> {
  const logger = createLogger("email-poll");
  const config = loadConfig(process.env, { requireSlack: false });

  if (!config.email?.imap.enabled) {
    throw new Error("EMAIL_IMAP_ENABLED=true is required to poll inbound email.");
  }

  const store = loadConfiguredStore(config);
  const inbound = await pollInboundEmailOnce({ config, store, logger });
  let outbound = { sent: 0, failed: 0, claimed: 0 };

  if (config.email.smtp.enabled) {
    assertSmtpConfig(config.email.smtp);
    outbound = await publishPendingEmailNotifications({
      store,
      sender: createSmtpEmailSender(config.email.smtp),
      logger
    });
  }

  process.stdout.write(`${JSON.stringify({ inbound, outbound })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
