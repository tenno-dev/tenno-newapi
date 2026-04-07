import { Hono } from "hono";
import { AppEnv } from "./app/types";
import { registerCoreRoutes } from "./routes/core";
import { registerWorldStateRoutes } from "./routes/worldstate";
import { registerDebugRoutes } from "./routes/debug";
import { handleTranslateQueue } from "./queue/consumer";

const app = new Hono<AppEnv>();

registerCoreRoutes(app);
registerWorldStateRoutes(app);
registerDebugRoutes(app);

export default {
  fetch: app.fetch,
  queue: handleTranslateQueue,
};