import { RawWorldState } from "../types/worldstate";

const DEFAULT_WORLDSTATE_URL = "https://api.warframe.com/cdn/worldState.php";

export async function fetchWorldState(
  input: RequestInfo | URL = DEFAULT_WORLDSTATE_URL,
  init?: RequestInit
): Promise<RawWorldState> {
  const response = await fetch(input, init);

  if (!response.ok) {
    throw new Error(`Failed to fetch worldState: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as unknown;

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid worldState payload: expected a JSON object");
  }

  return data as RawWorldState;
}
