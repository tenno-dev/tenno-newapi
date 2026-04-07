import { Hono } from "hono";
import { Bindings, AppEnv } from "./app/types";
import { registerCoreRoutes } from "./routes/core";
import { registerWorldStateRoutes } from "./routes/worldstate";
import { registerDebugRoutes } from "./routes/debug";
import { handleTranslateQueue } from "./queue/consumer";
import { executeWorldStatePush } from "./pipeline/worldstate";
import { executeTranslationSync } from "./pipeline/translations";

const app = new Hono<AppEnv>();

registerCoreRoutes(app);
registerWorldStateRoutes(app);
registerDebugRoutes(app);

async function handleScheduled(env: Bindings): Promise<void> {
  await executeWorldStatePush(env, { dryRun: false, force: false });
}

export default {
  fetch: app.fetch,
  queue: handleTranslateQueue,
  async scheduled(event: ScheduledEvent, env: Bindings): Promise<void> {
    if (event.cron === "0 0 * * *") {
      await executeTranslationSync(env);
    } else {
      await handleScheduled(env);
    }
  },
};