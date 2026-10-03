/** Shows an ISO-8601 UTC instant to the second; the input must already be in UTC. */
export function formatInstant(value: string): string {
  return `${value.slice(0, 10)} ${value.slice(11, 19)} UTC`;
}
