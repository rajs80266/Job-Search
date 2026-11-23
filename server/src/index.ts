import { createApp } from "./app";
import { adapterRegistry } from "./adapters";
import { DB_PATH, PORT, PROFILE_PATH, RECIPES_DIR } from "./config";
import { openDatabase } from "./db/connection";
import { abortRunningRuns } from "./db/refresh-runs";
import { createHttpClient } from "./lib/http";
import { loadProfile, writeProfile } from "./profile/store";
import { syncCompanies } from "./recipes/store";
import { createRefreshService } from "./refresh/service";

const db = openDatabase(DB_PATH);
abortRunningRuns(db, new Date().toISOString());
for (const { file, error } of syncCompanies(db, RECIPES_DIR).invalidFiles) {
  console.error(`Ignoring invalid recipe ${file}: ${error}`);
}

const http = createHttpClient();
const refreshService = createRefreshService({
  db,
  http,
  adapters: adapterRegistry,
  recipesDir: RECIPES_DIR,
  loadProfile: () => loadProfile(PROFILE_PATH),
});

createApp({
  db,
  refreshService,
  recipesDir: RECIPES_DIR,
  http,
  adapters: adapterRegistry,
  loadProfile: () => loadProfile(PROFILE_PATH),
  saveProfile: (profile) => writeProfile(PROFILE_PATH, profile),
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
