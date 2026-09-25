import type { Hono } from "hono";
import type { loadAiUsageStatus } from "../../aiUsage";
import { resolveAccountKindForTransport } from "../../billing/snapshot";
import type { AppEnv } from "../../server/app";
import type { loadRequestContextFromRequest } from "../../server/requestContext";
import { assertAiUsageHumanTransport } from "./support";

type AiUsageRouteOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn: typeof loadRequestContextFromRequest;
  loadAiUsageStatusFn: typeof loadAiUsageStatus;
}>;

/**
 * The app-facing read of the caller's tier, limits and this month's AI usage: the same payload the
 * agent surfaces serve as `get_usage_limits`. The account kind is read from the transport exactly as the
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

    const status = await options.loadAiUsageStatusFn(
      requestContext.userId,
      resolveAccountKindForTransport(requestContext.transport),
      new Date(),
    );
    return context.json(status);
  });
}
