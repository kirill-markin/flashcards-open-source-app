import { getAppConfig } from "../config";

export const browserHintsBridgePath = "/browser-hints";
export type AcceptedBrowserSignInMethod = "email" | "google" | "apple";
let informationGeneration = 0;
type BridgeOperation = "consume" | "forget";
type BridgeReply = Readonly<{ protocol: "nibomo-auth-hints-v1"; requestId: string }> & (
  | Readonly<{ status: "accepted"; method: AcceptedBrowserSignInMethod }>
  | Readonly<{ status: "absent" | "forgotten" }>
  | Readonly<{ status: "error"; code: "storage_unavailable" | "session_unavailable" }>
);

function bridgeOrigin(): string {
  const authUrl = new URL(getAppConfig().authBaseUrl);
  const pairs: Readonly<Record<string, string>> = {
    "https://app.nibomo.com": "https://auth.nibomo.com",
    "https://app.flashcards-open-source-app.com": "https://auth.flashcards-open-source-app.com",
    "http://localhost:3000": "http://localhost:8081",
    "http://127.0.0.1:3000": "http://127.0.0.1:8081",
  };
  if (pairs[window.location.origin] !== authUrl.origin || authUrl.username !== "" || authUrl.password !== ""
    || authUrl.pathname !== "/" || authUrl.search !== "" || authUrl.hash !== "") {
    throw new Error("Browser sign-in hints require this app's matching auth origin. Check the app auth URL configuration.");
  }
  return authUrl.origin;
}

function decodeReply(value: unknown, requestId: string): BridgeReply {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Browser sign-in hint bridge returned an invalid response. Reload and retry.");
  const reply = value as Readonly<Record<string, unknown>>;
  if (reply.protocol !== "nibomo-auth-hints-v1" || reply.requestId !== requestId) throw new Error("Browser sign-in hint bridge response did not match the request. Reload and retry.");
  if (reply.status === "accepted" && Object.keys(reply).length === 4
    && (reply.method === "email" || reply.method === "google" || reply.method === "apple")) return reply as BridgeReply;
  if ((reply.status === "absent" || reply.status === "forgotten") && Object.keys(reply).length === 3) return reply as BridgeReply;
  if (reply.status === "error" && Object.keys(reply).length === 4
    && (reply.code === "storage_unavailable" || reply.code === "session_unavailable")) return reply as BridgeReply;
  throw new Error("Browser sign-in hint bridge returned an invalid response. Reload and retry.");
}

function requestBridge(operation: BridgeOperation): Promise<BridgeReply> {
  const authOrigin = bridgeOrigin();
  const requestId = window.crypto.randomUUID();
  const iframe = document.createElement("iframe");
  iframe.hidden = true;
  iframe.title = "Browser sign-in information";
  iframe.referrerPolicy = "no-referrer";
  const url = new URL(browserHintsBridgePath, authOrigin);
  url.searchParams.set("operation", operation);

  return new Promise<BridgeReply>((resolve, reject) => {
    function finish(reply: BridgeReply | null, error: Error | null): void {
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      iframe.remove();
      if (error !== null) reject(error);
      else if (reply !== null) resolve(reply);
    }

    function receive(event: MessageEvent<unknown>): void {
      if (event.origin !== authOrigin || event.source !== iframe.contentWindow) return;
      try { finish(decodeReply(event.data, requestId), null); }
      catch { finish(null, new Error("Browser sign-in hint bridge returned an invalid response. Reload and retry.")); }
    }

    const timeout = window.setTimeout(() => finish(null, new Error("Browser sign-in hints did not respond. Allow frames and site data for the matching auth origin, then retry.")), 8_000);
    window.addEventListener("message", receive);
    iframe.addEventListener("error", () => finish(null, new Error("Browser sign-in hints could not load the auth bridge. Check connectivity and retry.")), { once: true });
    iframe.addEventListener("load", () => {
      if (iframe.contentWindow === null) {
        finish(null, new Error("Browser sign-in hint frame is unavailable. Reload and retry."));
        return;
      }
      iframe.contentWindow.postMessage({ protocol: "nibomo-auth-hints-v1", operation, requestId }, authOrigin);
    }, { once: true });
    iframe.src = url.toString();
    document.body.append(iframe);
  });
}

function requireSuccess(reply: BridgeReply): void {
  if (reply.status !== "error") return;
  throw new Error(reply.code === "storage_unavailable"
    ? "Browser sign-in information could not be read or cleared. Allow site data for the matching auth origin, then retry."
    : "The current sign-in session could not be verified. Check connectivity, refresh the session, and retry.");
}

export function readBrowserSignInInformationGeneration(): number {
  return informationGeneration;
}

/** Call only after the real account/workspace acceptance completes. Missing historical context has no attribution. */
export async function consumeAcceptedBrowserSignInMethod(): Promise<AcceptedBrowserSignInMethod | null> {
  const generation = informationGeneration;
  const reply = await requestBridge("consume");
  if (generation !== informationGeneration) return null;
  requireSuccess(reply);
  if (reply.status === "accepted") return reply.method;
  if (reply.status === "absent") return null;
  throw new Error("Browser sign-in hint bridge returned an unexpected consume result. Reload and retry.");
}

/** Also works after logout: it clears presentation data without requiring a session. */
export async function forgetBrowserSignInInformation(): Promise<void> {
  informationGeneration += 1;
  const reply = await requestBridge("forget");
  requireSuccess(reply);
  if (reply.status !== "forgotten") throw new Error("Browser sign-in hint bridge did not confirm forgetting. Reload and retry.");
}
