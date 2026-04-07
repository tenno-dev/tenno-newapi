import { RawWorldState } from "../types/worldstate";
import { TOP_LEVEL_WORLDSTATE_KEYS } from "../types/worldstate";

const DEFAULT_WORLDSTATE_URL = "https://api.warframe.com/cdn/worldState.php";

function hasKnownWorldStateShape(data: unknown): data is RawWorldState {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }

  return TOP_LEVEL_WORLDSTATE_KEYS.some((key) => key in (data as Record<string, unknown>));
}

function buildWorldStateRequestInit(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);

  if (!headers.has("accept")) {
    headers.set(
      "accept",
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
    );
  }
  if (!headers.has("accept-encoding")) {
    // Cloudflare Workers can receive zstd from some edges; force uncompressed JSON for safe parsing.
    headers.set("accept-encoding", "identity");
  }
  if (!headers.has("accept-language")) {
    headers.set("accept-language", "en-US,en;q=0.9");
  }
  if (!headers.has("referer")) {
    headers.set("referer", "https://www.warframe.com/");
  }
  if (!headers.has("origin")) {
    headers.set("origin", "https://www.warframe.com");
  }
  if (!headers.has("cache-control")) {
    headers.set("cache-control", "no-cache");
  }
  if (!headers.has("pragma")) {
    headers.set("pragma", "no-cache");
  }
  if (!headers.has("upgrade-insecure-requests")) {
    headers.set("upgrade-insecure-requests", "1");
  }
  if (!headers.has("sec-ch-ua")) {
    headers.set("sec-ch-ua", '"Chromium";v="147", "Not=A?Brand";v="8"');
  }
  if (!headers.has("sec-ch-ua-mobile")) {
    headers.set("sec-ch-ua-mobile", "?0");
  }
  if (!headers.has("sec-ch-ua-platform")) {
    headers.set("sec-ch-ua-platform", '"Windows"');
  }
  if (!headers.has("sec-fetch-dest")) {
    headers.set("sec-fetch-dest", "document");
  }
  if (!headers.has("sec-fetch-mode")) {
    headers.set("sec-fetch-mode", "navigate");
  }
  if (!headers.has("sec-fetch-site")) {
    headers.set("sec-fetch-site", "none");
  }
  if (!headers.has("sec-fetch-user")) {
    headers.set("sec-fetch-user", "?1");
  }
  if (!headers.has("user-agent")) {
    headers.set(
      "user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
    );
  }

  return {
    ...init,
    headers,
    redirect: init?.redirect ?? "follow",
  };
}

export async function fetchWorldState(
  input: RequestInfo | URL = DEFAULT_WORLDSTATE_URL,
  init?: RequestInit
): Promise<RawWorldState> {
  const requestInit = buildWorldStateRequestInit(init);
  const response = await fetch(input, requestInit);

  if (!response.ok) {
    throw new Error(`Failed to fetch worldState: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as unknown;

  if (!hasKnownWorldStateShape(data)) {
    throw new Error("Invalid worldState payload: expected official worldState shape");
  }

  return data as RawWorldState;
}
