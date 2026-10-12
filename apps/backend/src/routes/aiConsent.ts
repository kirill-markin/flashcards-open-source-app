import { Hono } from "hono";
import { recordAiConsent } from "../aiConsent";
import { parseAiConsentInput } from "../aiConsent/input";
import type { AppEnv } from "../server/app";
import { loadRequestContextFromRequest } from "../server/requestContext";
import { parseJsonBodyWithByteLimit } from "../server/requestParsing";
import { HttpError } from "../shared/errors";

export function createAiConsentRoutes(options: Readonly<{
  allowedOrigins: ReadonlyArray<string>;
}>): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post("/ai/consent", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    if (!["bearer", "session", "guest"].includes(requestContext.transport)) {
      throw new HttpError(403, "AI consent requires Guest, Bearer, or Session authentication.", "AI_CONSENT_HUMAN_AUTH_REQUIRED");
    }
    const input = parseAiConsentInput(await parseJsonBodyWithByteLimit(
      context.req.raw, 100_000, "AI consent disclosure is too large.", "AI_CONSENT_BODY_TOO_LARGE",
    ));
    return context.json(await recordAiConsent(requestContext.userId, input, requestContext.guestSessionId));
  });
  return app;
}
