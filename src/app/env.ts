import { AppContext } from "./types";

const DEV_VALUES = new Set(["dev", "development", "local", "test", "testing"]);

export function isDevRequest(c: AppContext): boolean {
  const appEnv = c.env.APP_ENV?.toLowerCase().trim();
  if (appEnv && DEV_VALUES.has(appEnv)) {
    return true;
  }

  const hostname = new URL(c.req.url).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
