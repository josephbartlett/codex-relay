import { App } from "@slack/bolt";
import { loadConfig } from "../../../packages/shared/src/config.js";
import { createLogger } from "../../../packages/shared/src/logging.js";
import { runStartupChecks } from "../../local-runner/src/startupChecks.js";
import { ExecAdapter } from "../../orchestrator/src/runner/ExecAdapter.js";
import { loadConfiguredStore } from "../../orchestrator/src/persistence/storeFactory.js";
import { Orchestrator } from "../../orchestrator/src/tasks.js";
import { registerActionListeners } from "./listeners/actions.js";
import { registerCommandListeners } from "./listeners/commands.js";
import { registerHomeListeners } from "./listeners/home.js";
import { registerMentionListeners } from "./listeners/mentions.js";
import { registerShortcutListeners } from "./listeners/shortcuts.js";
import { startSlackNotificationPublisher } from "./slackNotificationPublisher.js";

const logger = createLogger("slack-gateway");
const config = loadConfig();
const startup = await runStartupChecks(config);

for (const warning of startup.warnings) {
  logger.warn(warning);
}

if (startup.failures.length > 0) {
  for (const failure of startup.failures) {
    logger.error(failure);
  }

  throw new Error("Slack gateway startup checks failed.");
}

const app = new App({
  token: config.slack.botToken,
  appToken: config.slack.appToken,
  signingSecret: config.slack.signingSecret || "socket-mode",
  socketMode: true
});

const store = loadConfiguredStore(config);
const runner = new ExecAdapter({
  command: config.codex.command,
  model: config.codex.model,
  envAllowlist: config.codex.runnerEnvAllowlist
});
const orchestrator = new Orchestrator(config, store, runner);

registerMentionListeners(app, orchestrator, config);
registerActionListeners(app, orchestrator, config);
registerCommandListeners(app, orchestrator, config);
registerShortcutListeners(app, orchestrator, config);
registerHomeListeners(app, orchestrator);

await app.start();
startSlackNotificationPublisher({ store, client: app.client, logger });
logger.info("Slack gateway started in Socket Mode.");
