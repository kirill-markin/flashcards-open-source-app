import { Hono } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { createAuthAttempt } from "../../server/social/attemptStore.js";
import { parseNativeAttempt, parseSocialObject, parseProviderTarget } from "../../server/social/publicContract.js";
import { requireNativeProvider, requireSignInProvider } from "../../server/social/publicMethods.js";
import { readSocialJson, requireSocialRequest, socialErrorResponse } from "./http.js";
import { beginAccountProviderReauthentication, beginAccountProviderLink, beginAccountProviderReenable } from "../../server/social/accountMethods.js";
import { AuthAttemptError } from "../../server/social/attemptContract.js";
import { accountAttempt, accountProof, accountTransport } from "./accountTransport.js";

const app = new Hono<AuthAppEnv>();
app.post("/api/social/attempt", async (c) => {
  try {
    await requireSocialRequest(c, "start");
    const fields = parseSocialObject(await readSocialJson(c));
    if (fields.purpose !== "login") {
      const transport = await accountTransport(c, fields);
      if (transport.browser !== null) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
      const request = accountAttempt(fields, transport);
      requireSignInProvider(request.provider, request.client);
      const authOrigin = new URL(c.req.url).origin;
      const response = request.purpose === "reauth"
        ? await beginAccountProviderReauthentication(transport.sessionToken, request, null, authOrigin)
        : fields.intent === "reenable"
          ? await beginAccountProviderReenable(transport.sessionToken, parseProviderTarget(fields.target), request,
            accountProof(c, fields, transport), null, authOrigin)
          : fields.intent === "link"
            ? await beginAccountProviderLink(transport.sessionToken, request, accountProof(c, fields, transport), null, authOrigin)
            : (() => { throw new AuthAttemptError("AUTH_ATTEMPT_INVALID"); })();
      return c.json({ ...response, browserStart: request.client === "android" && request.provider === "apple"
        ? "/api/social/apple/start?client=android&attempt=" + response.attempt : null });
    }
    const request = parseNativeAttempt(fields);
    requireNativeProvider(request.provider, request.client);
    const response = await createAuthAttempt(request,
      { purpose: "login", subject: null, account: null, reauthCompletion: null }, null, new URL(c.req.url).origin);
    return c.json(response);
  } catch (error) {
    return socialErrorResponse(c, error);
  }
});
export default app;
