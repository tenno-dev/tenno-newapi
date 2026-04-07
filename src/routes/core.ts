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
}