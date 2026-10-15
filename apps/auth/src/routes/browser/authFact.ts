import { Hono } from "hono";
import { type AuthAppEnv, jsonAuthError } from "../../server/apiErrors.js";
import { reportAuthFact } from "../../server/analytics/signInFunnel.js";
import { readSocialBody } from "../social/http.js";

const app = new Hono<AuthAppEnv>();
app.post("/api/auth-fact", async (c) => {
  c.header("Cache-Control", "no-store");
  if (c.req.header("origin") !== new URL(c.req.url).origin
    || c.req.header("content-type")?.split(";")[0].trim() !== "application/json") {
    return jsonAuthError(c, 400, "INVALID_REQUEST", "Invalid sign-in fact request.");
  }
  const raw = await readSocialBody(c);
  let value: unknown;
  try { value = raw.length <= 256 ? JSON.parse(raw) : null; }
  catch { value = null; }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return jsonAuthError(c, 400, "INVALID_REQUEST", "Invalid sign-in fact.");
  }
  const fact = value as Readonly<Record<string, unknown>>;
  const { eventName, method } = fact;
  if (Object.keys(fact).length === 3 && eventName === "auth_account_link_finished" && fact.outcome === "cancelled"
    && (method === "google" || method === "apple") && c.req.query("screen") === "settings") {
    await reportAuthFact(c, { eventName, method, outcome: "cancelled" });
    return c.body(null, 204);
  }
  if (Object.keys(fact).length !== 2 || (method !== "email" && method !== "google" && method !== "apple")
    || (eventName !== "auth_method_selected" && eventName !== "auth_code_form_shown"
      && eventName !== "auth_code_submitted" && eventName !== "auth_code_resend_requested")) {
    return jsonAuthError(c, 400, "INVALID_REQUEST", "Unsupported sign-in fact.");
  }
  await reportAuthFact(c, { eventName, method });
  return c.body(null, 204);
});
export default app;
