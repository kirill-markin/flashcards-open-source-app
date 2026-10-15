import { Hono } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { unlinkAccountProviderMethod } from "../../server/social/accountMethods.js";
import { parseProviderTarget, parseSocialObject } from "../../server/social/publicContract.js";
import { accountProof, accountTransport } from "./accountTransport.js";
import { readSocialJson, requireSocialRequest, socialErrorResponse } from "./http.js";

const app = new Hono<AuthAppEnv>();
app.post("/api/account/provider-methods/unlink", async (c) => {
  try {
    await requireSocialRequest(c, "manage");
    const fields = parseSocialObject(await readSocialJson(c));
    const transport = await accountTransport(c, fields);
    await unlinkAccountProviderMethod(transport.sessionToken, parseProviderTarget(fields.target), accountProof(c, fields, transport));
    return c.json({ ok: true });
  } catch (error) {
    return socialErrorResponse(c, error);
  }
});
export default app;
