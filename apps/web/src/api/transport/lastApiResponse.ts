// Wall-clock `Date.now()` of the latest API response body read in full in this page session, any status;
// headers alone do not count, so a body cut off mid-read cannot vouch for its own failure.
// Wall-clock time keeps advancing through system sleep, so a response from before a laptop slept stays old.
let lastApiResponseAtMs: number | null = null;

export function recordApiResponseReceived(): void {
  lastApiResponseAtMs = Date.now();
}

export function readLastApiResponseAtMs(): number | null {
  return lastApiResponseAtMs;
}

export function resetLastApiResponseForTests(): void {
  lastApiResponseAtMs = null;
}
