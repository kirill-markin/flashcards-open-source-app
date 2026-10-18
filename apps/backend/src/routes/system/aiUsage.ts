import type { Hono } from "hono";
import { loadBrowserGuestAiTrialStatus } from "../../aiUsage/browserGuestTrial/repository";
import { getBrowserGuestCapabilities } from "../../guestAuth/webPlatform";
import type { loadAiUsageStatus } from "../../aiUsage";
import { resolveEntitlementLimits } from "../../billing/limits";
import { resolveAccountKindForTransport } from "../../billing/snapshot";
import type { AppEnv } from "../../server/app";
import type { loadRequestContextFromRequest } from "../../server/requestContext";
import { assertAiUsageHumanTransport } from "./support";

type AiUsageRouteOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn: typeof loadRequestContextFromRequest;
  loadAiUsageStatusFn: typeof loadAiUsageStatus;
  loadBrowserGuestAiTrialStatusFn: typeof loadBrowserGuestAiTrialStatus;
}>;

/**
 * The account kind is read from the transport exactly as the
 * chat route reads it when it enforces the allowance, so the count reported here is the one enforced.
 */
export function registerAiUsageRoute(
  app: Hono<AppEnv>,
  options: AiUsageRouteOptions,
): void {
  app.get("/me/ai-usage", async (context) => {
    const { requestContext } = await options.loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );

    assertAiUsageHumanTransport(requestContext.transport);

    const accountKind = resolveAccountKindForTransport(requestContext.transport);
    const status = await options.loadAiUsageStatusFn(
      requestContext.userId,
      accountKind,
      new Date(),
    );
    const browserGuestAiTrial = await options.loadBrowserGuestAiTrialStatusFn(requestContext);
    return context.json({
      browserGuestAiTrial,
      ...status,
      premiumAiMonthlyMessages: resolveEntitlementLimits("premium", accountKind).aiMonthlyMessages,
      browserGuestCapabilities: getBrowserGuestCapabilities(requestContext),
    });
  });
}
