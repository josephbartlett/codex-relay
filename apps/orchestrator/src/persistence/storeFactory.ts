import type { HarnessConfig } from "../../../../packages/shared/src/config.js";
import type { InMemoryStore } from "./inMemory.js";
import { JsonFileStore } from "./jsonFileStore.js";
import { SqliteStore } from "./sqliteStore.js";

export function loadConfiguredStore(config: HarnessConfig): InMemoryStore {
  return config.codex.storeKind === "sqlite"
    ? SqliteStore.load({
        databasePath: config.codex.databasePath,
        migrateFromJsonPath: config.codex.statePath
      })
    : JsonFileStore.load(config.codex.statePath);
}
