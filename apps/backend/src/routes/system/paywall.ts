import type { Hono } from "hono";
import {
  loadPaywallState,
  parsePaywallShownInput,
  recordPaywallShown,
} from "../../paywallState";
import type { AppEnv } from "../../server/app";
import type { loadRequestContextFromRequest } from "../../server/requestContext";
import { expectRecord, parseJsonBody } from "../../server/requestParsing";
import { assertAccountPreferencesHumanTransport } from "./support";

type PaywallRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn: typeof loadRequestContextFromRequest;
}>;

export function registerPaywallRoutes(app: Hono<AppEnv>, options: PaywallRoutesOptions): void {
  app.get("/me/paywall-state", async (context) => {
    const { requestContext } = await options.loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );
    assertAccountPreferencesHumanTransport(requestContext.transport);
    return context.json(await loadPaywallState(requestContext.userId));
  });

  app.post("/me/paywall-shown", async (context) => {
    const { requestContext } = await options.loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );
    assertAccountPreferencesHumanTransport(requestContext.transport);
    const input = parsePaywallShownInput(expectRecord(await parseJsonBody(context.req.raw)));
    return context.json(await recordPaywallShown(requestContext.userId, input));
  });
}
