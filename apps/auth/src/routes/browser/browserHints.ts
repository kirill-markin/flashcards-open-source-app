import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { validateSessionToken, type BrowserSessionPresentation } from "../../server/browserSession.js";
import { browserScriptJson } from "../../templates/browserCompletion.js";
import { browserHintStorageScript } from "../../templates/browserHints.js";

export const browserHintsBridgePath = "/browser-hints";
const app = new Hono<AuthAppEnv>();

function allowedParents(authOrigin: string): ReadonlyArray<string> {
  const pairs: Readonly<Record<string, string>> = {
    "https://auth.nibomo.com": "https://app.nibomo.com",
    "https://auth.flashcards-open-source-app.com": "https://app.flashcards-open-source-app.com",
    "http://localhost:8081": "http://localhost:3000",
    "http://127.0.0.1:8081": "http://127.0.0.1:3000",
  };
  const parent = pairs[authOrigin];
  const configured = (process.env.ALLOWED_REDIRECT_URIS ?? "").split(",").map((value) => value.trim());
  return parent !== undefined && configured.includes(parent) ? [parent] : [];
}

app.get(browserHintsBridgePath, async (c) => {
  const parents = allowedParents(new URL(c.req.url).origin);
  const operation = c.req.query("operation");
  const nonce = randomBytes(32).toString("base64url");
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", undefined);
  c.header("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors ${parents.length === 0 ? "'none'" : parents.join(" ")}`);
  if (parents.length === 0 || (operation !== "consume" && operation !== "forget")) return c.text("Invalid browser hint bridge request", 400);

  let current: BrowserSessionPresentation | null = null;
  let verificationFailed = false;
  if (operation === "consume") {
    const cookie = getCookie(c, "session");
    if (cookie !== undefined) {
      const validation = await validateSessionToken(cookie);
      if (validation.status === "valid") current = validation.presentation ?? null;
      else if (validation.status === "error") verificationFailed = true;
    }
  }

  return c.html(`<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"></head><body>
    <script nonce="${nonce}">
    ${browserHintStorageScript}
    const bridge = ${browserScriptJson({ parents, operation, current, verificationFailed })};
    let handled = false;
    window.addEventListener("message", async function(event) {
      if (handled || window.parent === window || event.source !== window.parent || !bridge.parents.includes(event.origin)) return;
      const request = event.data;
      if (!request || typeof request !== "object" || Array.isArray(request)
        || Object.keys(request).length !== 3 || request.protocol !== "nibomo-auth-hints-v1"
        || request.operation !== bridge.operation || typeof request.requestId !== "string"
        || !/^[a-f0-9-]{36}$/.test(request.requestId)) return;
      handled = true;
      let result;
      try {
        if (request.operation === "forget") {
          await browserHints.forget();
          result = { status: "forgotten" };
        } else if (bridge.verificationFailed) {
          result = { status: "error", code: "session_unavailable" };
        } else {
          const accepted = browserHints.consume(bridge.current, event.origin);
          result = accepted === null ? { status: "absent" } : { status: "accepted", ...accepted };
        }
      } catch {
        result = { status: "error", code: "storage_unavailable" };
      }
      window.parent.postMessage({ protocol: request.protocol, requestId: request.requestId, ...result }, event.origin);
    });
    </script></body></html>`);
});

export default app;
