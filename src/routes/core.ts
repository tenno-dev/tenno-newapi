import { Hono } from "hono";
import { ACTIVE_ROUTES } from "../app/routes";
import { AppEnv } from "../app/types";

export function registerCoreRoutes(app: Hono<AppEnv>): void {
  app.get("/", (c) => {
    return c.json({
      ok: true,
      message: "Active routes",
      routes: ACTIVE_ROUTES,
    });
  });

  app.get("/health", (c) => {
    return c.json({ status: "healthy" });
  });

  app.get("/bindings", (c) => {
    return c.json({
      kvPrepared: !!c.env.TENNODEV_WORLDSTATE_KV,
      r2Prepared: !!c.env.TENNODEV_ASSETS_R2,
      d1Prepared: !!c.env.TENNODEV_WORLDSTATE_D1,
      queueActive: !!c.env.TENNODEV_PUSH_QUEUE,
      queueBinding: "TENNODEV_PUSH_QUEUE",
    });
  });
}