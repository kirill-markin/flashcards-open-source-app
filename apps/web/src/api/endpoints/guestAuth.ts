import {
  parseWebGuestSessionResponse,
  type WebGuestSessionEnvelope,
} from "../../apiContracts/guestAuth";
import { parseContractResponse } from "../transport/response";
import { requestGuestJson, skipAuthRecoveryWithoutNetworkRetry } from "../transport/transport";

/**
 * Budget for the single attempt this call makes. Without it a hung fetch never settles and the
 * caller's one attempt for this page load is parked in flight for the rest of it, measuring nothing.
 * Long enough that an ordinary slow network still succeeds, because a request that times out may
 * have created the server-side rows anyway and a later interaction that retries then mints a second
 * set nothing will ever read.
 */
const createWebGuestSessionTimeoutMs = 10 * 1000;

/**
 * Creates a guest session bound to the web platform.
 *
 * The request carries no credential of its own, so it goes out through the guest transport rather
 * than the session one: the session pipeline loads `/me` first to obtain a CSRF token, which a
 * signed-out browser has no way to get. Auth recovery is skipped for the same reason — a signed-out
 * visitor must never be redirected to sign in because analytics wanted an identity.
 *
 * It is also sent exactly once, never retried. The route has no idempotency key: every call writes a
 * guest user, a workspace, a membership and the session row, and nothing removes them. A connection
 * dropped after the server committed is indistinguishable from one dropped before it, so a transient
 * retry mints a second permanent set of rows from one interaction — the same failure the timeout
 * above exists to bound, reached by a different route. Not creating the rows is always the cheaper
 * mistake here, and it costs nothing durable: `webGuestSession.ts` re-arms after its own retry delay,
 * so a genuinely transient failure gets another chance from the next interaction, and the events
 * wait in the local queue under their 14-day TTL until it does.
 */
export async function createWebGuestSession(): Promise<WebGuestSessionEnvelope> {
  return parseContractResponse(
    await requestGuestJson("/guest-auth/session", {
      method: "POST",
      body: JSON.stringify({ platform: "web" }),
      signal: AbortSignal.timeout(createWebGuestSessionTimeoutMs),
    }, null, skipAuthRecoveryWithoutNetworkRetry),
    "POST /guest-auth/session",
    parseWebGuestSessionResponse,
  );
}
