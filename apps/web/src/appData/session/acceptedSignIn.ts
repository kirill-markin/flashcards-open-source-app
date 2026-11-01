import {
  consumeAcceptedBrowserSignInMethod,
  type AcceptedBrowserSignInMethod,
  type BrowserConnectionSuggestion,
} from "../../api/browserHints";

const storageKey = "nibomo-accepted-sign-in-v1";

/** The bridge's one-use answer for the current session cookie's sign-in. */
export type AcceptedSignInAnswer = Readonly<{
  method: AcceptedBrowserSignInMethod;
  connectionSuggestion: BrowserConnectionSuggestion | null;
}>;

/** The bridge answers once, so this tab keeps the answer, bound to a verified owner, until account readiness is reported. */
export type AcceptedSignIn = AcceptedSignInAnswer & Readonly<{
  userId: string;
  sessionAcceptedTracked: boolean;
  guestUpgradeCompleted: boolean;
}>;

function storageError(): Error {
  return new Error("This tab could not keep the accepted sign-in method. Allow site data for this app, then reload.");
}

function parseSuggestion(value: unknown): BrowserConnectionSuggestion | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("invalid connection suggestion");
  const suggestion = value as Readonly<Record<string, unknown>>;
  if (typeof suggestion.suggestion !== "string" || typeof suggestion.expiresAt !== "string") throw new Error("invalid connection suggestion");
  return { suggestion: suggestion.suggestion, expiresAt: suggestion.expiresAt };
}

/** Returns null for a damaged record. */
function parseAcceptedSignIn(raw: string): AcceptedSignIn | null {
  try {
    const value = JSON.parse(raw) as Readonly<Record<string, unknown>>;
    if (typeof value.userId !== "string"
      || (value.method !== "email" && value.method !== "google" && value.method !== "apple")
      || typeof value.sessionAcceptedTracked !== "boolean" || typeof value.guestUpgradeCompleted !== "boolean") {
      throw new Error("invalid accepted sign-in");
    }
    return { userId: value.userId, method: value.method, connectionSuggestion: parseSuggestion(value.connectionSuggestion),
      sessionAcceptedTracked: value.sessionAcceptedTracked, guestUpgradeCompleted: value.guestUpgradeCompleted };
  } catch {
    return null;
  }
}

export function readStoredAcceptedSignIn(): AcceptedSignIn | null {
  let raw: string | null;
  try { raw = window.sessionStorage.getItem(storageKey); } catch { throw storageError(); }
  if (raw === null) return null;
  const accepted = parseAcceptedSignIn(raw);
  // A damaged record is dropped, so it cannot fail every later read.
  if (accepted === null) clearAcceptedSignIn();
  return accepted;
}

function storeAcceptedSignIn(accepted: AcceptedSignIn): void {
  try { window.sessionStorage.setItem(storageKey, JSON.stringify(accepted)); } catch { throw storageError(); }
}

export function clearAcceptedSignIn(): void {
  try { window.sessionStorage.removeItem(storageKey); } catch { throw storageError(); }
}

let consuming: Promise<AcceptedSignInAnswer | null> | null = null;

/** Concurrent readers share one bridge consume, because only one of them would get its one-use answer. */
export function consumeAcceptedSignIn(): Promise<AcceptedSignInAnswer | null> {
  if (consuming !== null) return consuming;
  let connectionSuggestion: BrowserConnectionSuggestion | null = null;
  const started = consumeAcceptedBrowserSignInMethod((suggestion) => { connectionSuggestion = suggestion; })
    .then((method) => method === null ? null : { method, connectionSuggestion });
  consuming = started;
  const release = (): void => { if (consuming === started) consuming = null; };
  started.then(release, release);
  return started;
}

/** Call only with an owner verified against the session cookie the answer came from. */
export function bindAcceptedSignIn(userId: string, answer: AcceptedSignInAnswer): AcceptedSignIn {
  const stored = readStoredAcceptedSignIn();
  if (stored?.userId === userId) return stored;
  const accepted: AcceptedSignIn = { userId, method: answer.method, connectionSuggestion: answer.connectionSuggestion,
    sessionAcceptedTracked: false, guestUpgradeCompleted: false };
  storeAcceptedSignIn(accepted);
  return accepted;
}

/**
 * Returns this tab's accepted sign-in for the verified `userId`, consuming the bridge only when none
 * is stored. Another owner's record is discarded, never taken over.
 */
export async function readAcceptedSignIn(userId: string): Promise<AcceptedSignIn | null> {
  const stored = readStoredAcceptedSignIn();
  if (stored?.userId === userId) return stored;
  if (stored !== null) clearAcceptedSignIn();
  const answer = await consumeAcceptedSignIn();
  if (answer !== null) return bindAcceptedSignIn(userId, answer);
  // Absent means settled only when no concurrent reader stored this owner's answer meanwhile.
  const after = readStoredAcceptedSignIn();
  return after?.userId === userId ? after : null;
}

function updateAcceptedSignIn(userId: string, change: Partial<Pick<AcceptedSignIn, "sessionAcceptedTracked" | "guestUpgradeCompleted">>): void {
  const stored = readStoredAcceptedSignIn();
  if (stored?.userId === userId) storeAcceptedSignIn({ ...stored, ...change });
}

export function markSessionAcceptedTracked(userId: string): void {
  updateAcceptedSignIn(userId, { sessionAcceptedTracked: true });
}

/** Reported by the lifecycle after account readiness; without a known method nothing is reported. */
export async function recordGuestUpgradeCompleted(destinationUserId: string): Promise<void> {
  // A running consume may still store this owner's answer.
  await consuming?.catch((): null => null);
  updateAcceptedSignIn(destinationUserId, { guestUpgradeCompleted: true });
}

export function withdrawGuestUpgradeCompleted(destinationUserId: string): void {
  updateAcceptedSignIn(destinationUserId, { guestUpgradeCompleted: false });
}
