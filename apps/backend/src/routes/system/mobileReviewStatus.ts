import type { Hono } from "hono";
import {
  transactionWithUserScopeReadOnly,
  type DatabaseExecutor,
} from "../../database";
import type { AppEnv } from "../../server/app";
import type { loadRequestContextFromRequest } from "../../server/requestContext";
import { assertReviewPlatformSummaryHumanTransport } from "./support";
import type {
  LoadReviewPlatformSummaryFn,
  ReviewPlatformSummary,
} from "./types";

type MobileReviewStatusRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn: typeof loadRequestContextFromRequest;
  loadReviewPlatformSummaryFn: LoadReviewPlatformSummaryFn;
}>;

type MobileReviewStatusRow = Readonly<{
  has_mobile_review_event: boolean;
}>;

function mapMobileReviewStatusRow(row: MobileReviewStatusRow | undefined): ReviewPlatformSummary {
  if (row === undefined) {
    throw new Error("Failed to load review platform summary: database returned no rows.");
  }

  if (typeof row.has_mobile_review_event !== "boolean") {
    throw new Error("Failed to load review platform summary: has_mobile_review_event was not a boolean.");
  }

  return {
    hasMobileReviewEvent: row.has_mobile_review_event,
  };
}

export async function loadReviewPlatformSummaryInExecutor(
  executor: DatabaseExecutor,
): Promise<ReviewPlatformSummary> {
  const result = await executor.query<MobileReviewStatusRow>(
    "SELECT content.current_user_has_mobile_review_event() AS has_mobile_review_event",
    [],
  );

  return mapMobileReviewStatusRow(result.rows[0]);
}

export async function loadReviewPlatformSummary(userId: string): Promise<ReviewPlatformSummary> {
  return transactionWithUserScopeReadOnly(
    { userId },
    async (executor) => loadReviewPlatformSummaryInExecutor(executor),
  );
}

export function registerMobileReviewStatusRoute(
  app: Hono<AppEnv>,
  options: MobileReviewStatusRoutesOptions,
): void {
  app.get("/me/review-platform-summary", async (context) => {
    const { requestContext } = await options.loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );

    assertReviewPlatformSummaryHumanTransport(requestContext.transport);

    const summary = await options.loadReviewPlatformSummaryFn(requestContext.userId);

    return context.json({
      hasMobileReviewEvent: summary.hasMobileReviewEvent,
    } satisfies ReviewPlatformSummary);
  });
}
