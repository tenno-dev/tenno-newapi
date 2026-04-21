import type { Bindings } from "./types";

const DEV_VALUES = new Set(["dev", "development", "local", "test", "testing"]);

export function isDevRequest(env: Pick<Bindings, "APP_ENV">, requestUrl: string): boolean {
  const appEnv = env.APP_ENV?.toLowerCase().trim();
  if (appEnv && DEV_VALUES.has(appEnv)) {
    return true;
  }

  const hostname = new URL(requestUrl).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
