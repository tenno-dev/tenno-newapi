import { Hono } from "hono";
import { cors } from "hono/cors";
import { Bindings, AppEnv } from "./app/types";
import { registerCoreRoutes } from "./routes/core";
import { registerWorldStateRoutes } from "./routes/worldstate";
import { registerDebugRoutes } from "./routes/debug";
import { pushRoutes } from "./routes/push";
import { handleTranslateQueue } from "./queue/consumer";
import { executeWorldStatePush } from "./pipeline/worldstate";
import { executeTranslationSync } from "./pipeline/translations";

const app = new Hono<AppEnv>();

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const configured = c.env.CORS_ALLOWED_ORIGINS
        ? c.env.CORS_ALLOWED_ORIGINS.split(",")
            .map((entry: string) => entry.trim())
            .filter(Boolean)
        : [];

      const allowed = new Set<string>([
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        ...configured,
      ]);

      if (!origin) {
        return "*";
      }

      return allowed.has(origin) ? origin : "";
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

registerCoreRoutes(app);
registerWorldStateRoutes(app);
registerDebugRoutes(app);
app.route("/", pushRoutes);

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