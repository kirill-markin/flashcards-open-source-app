import { Hono } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { createAuthAttempt } from "../../server/social/attemptStore.js";
import { parseNativeAttempt } from "../../server/social/publicContract.js";
import { requireNativeProvider } from "../../server/social/publicMethods.js";
import { readSocialJson, requireSocialRequest, socialErrorResponse } from "./http.js";

const app = new Hono<AuthAppEnv>();
app.post("/api/social/attempt", async (c) => {
  try {
    await requireSocialRequest(c, "start");
    const request = parseNativeAttempt(await readSocialJson(c));
    requireNativeProvider(request.provider, request.client);
    const response = await createAuthAttempt(request,
      { purpose: "login", subject: null, account: null, reauthCompletion: null }, null, new URL(c.req.url).origin);
    return c.json(response);
  } catch (error) {
    return socialErrorResponse(c, error);
  }
});
export default app;
