export function parseLimit(input: string | undefined, fallback = 50, max = 200): number {
  const parsed = Number.parseInt(input ?? "", 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
}

export function parseBoolean(input: string | undefined): boolean {
  if (!input) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(input.toLowerCase());
}