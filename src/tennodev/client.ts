import { RawWorldState } from "../types/worldstate";

const DEFAULT_WORLDSTATE_URL = "https://api.warframe.com/cdn/worldState.php";
const FALLBACK_WORLDSTATE_URLS = [
  DEFAULT_WORLDSTATE_URL,
  "https://content.warframe.com/dynamic/worldState.php",
  "https://api.warframestat.us/pc",
] as const;

function buildWorldStateRequestInit(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);

  if (!headers.has("accept")) {
    headers.set("accept", "application/json,text/plain,*/*");
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
  const candidates =
    input === DEFAULT_WORLDSTATE_URL
      ? FALLBACK_WORLDSTATE_URLS
      : [input.toString(), ...FALLBACK_WORLDSTATE_URLS.filter((url) => url !== input.toString())];

  let lastError = "Unknown fetch failure";

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, requestInit);

      if (!response.ok) {
        lastError = `Failed to fetch worldState from ${candidate}: ${response.status} ${response.statusText}`;
        continue;
      }

      const data = (await response.json()) as unknown;

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        lastError = `Invalid worldState payload from ${candidate}: expected a JSON object`;
        continue;
      }

      return data as RawWorldState;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown fetch failure";
    }
  }

  throw new Error(lastError);
}
