import { Hono } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { listAccountLoginMethods } from "../../server/social/accountMethods.js";
import { parseSocialClient } from "../../server/social/publicContract.js";
import { createAccountBrowserContext, requireAccountSession } from "./accountTransport.js";
import { requireSocialRequest, socialErrorResponse } from "./http.js";

const app = new Hono<AuthAppEnv>();
app.get("/api/account/login-methods", async (c) => {
  try {
    await requireSocialRequest(c, "manage");
    const client = parseSocialClient(c.req.query("client"));
    const session = await requireAccountSession(c, client === "web" ? "web" : "native");
    const { methods, verifiedRecoveryEmails } = await listAccountLoginMethods(session);
    const csrfToken = client === "web" ? createAccountBrowserContext(c) : null;
    return c.json({ methods, verifiedRecoveryEmails, emailRecovery: "read_only", csrfToken });
  } catch (error) {
    return socialErrorResponse(c, error);
  }
});
export default app;
