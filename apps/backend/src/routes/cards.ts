import { Hono } from "hono";
import {
  parseCardFilterInput,
  listWorkspaceTagsSummary,
  queryCardsPage,
  type CardFilter,
  type CardQuerySort,
  type CardQuerySortDirection,
  type CardQuerySortKey,
  type WorkspaceTagsSummary,
} from "../cards";
import { HttpError } from "../shared/errors";
import {
  loadRequestContextFromRequest,
  parseWorkspaceIdParam,
} from "../server/requestContext";
import {
  expectNullableNonEmptyString,
  expectRecord,
  parseJsonBody,
} from "../server/requestParsing";
import { createBackendFailureDetails } from "../server/logging";
import {
  addBackendBreadcrumb,
  createBackendObservationScope,
  normalizeCaughtError,
  type BackendObservationScope,
} from "../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../observability/reporting";
import { assertUserHasWorkspaceAccess } from "../workspaces";
import type { AppEnv } from "../server/app";

type CardsRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
}>;

type QueryCardsRequestBody = Readonly<{
  searchText: string | null;
  cursor: string | null;
  limit: number;
  sorts: ReadonlyArray<CardQuerySort>;
  filter: CardFilter | null;
}>;

type WorkspaceTagsSummaryResponse = WorkspaceTagsSummary;

const allowedCardQuerySortKeys: ReadonlyArray<CardQuerySortKey> = [
  "frontText",
  "backText",
  "tags",
  "effortLevel",
  "dueAt",
  "reps",
  "lapses",
  "createdAt",
];

function createCardsScope(
  requestId: string,
  route: string,
  method: string,
  userId: string,
  workspaceId: string,
): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    requestId,
    route,
    method,
    userId,
    workspaceId,
    null,
    null,
    null,
  );
}

function expectSortDirection(value: unknown): CardQuerySortDirection {
  if (value === "asc" || value === "desc") {
    return value;
  }

  throw new HttpError(400, "sorts direction must be asc or desc");
}

function expectSortKey(value: unknown): CardQuerySortKey {
  if (typeof value !== "string" || allowedCardQuerySortKeys.includes(value as CardQuerySortKey) === false) {
    throw new HttpError(400, "sorts key is unsupported");
  }

  return value as CardQuerySortKey;
}

function expectSorts(value: unknown): ReadonlyArray<CardQuerySort> {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "sorts must be an array");
  }

  return value.map((item, index) => {
    const record = expectRecord(item);
    return {
      key: expectSortKey(record.key),
      direction: expectSortDirection(record.direction),
    };
  });
}

export function parseQueryCardsRequestBody(value: unknown): QueryCardsRequestBody {
  const record = expectRecord(value);
  const limitValue = record.limit;
  if (typeof limitValue !== "number" || Number.isInteger(limitValue) === false) {
    throw new HttpError(400, "limit must be an integer");
  }

  return {
    searchText: record.searchText === undefined
      ? null
      : expectNullableNonEmptyString(record.searchText, "searchText"),
    cursor: record.cursor === undefined
      ? null
      : expectNullableNonEmptyString(record.cursor, "cursor"),
    limit: limitValue,
    sorts: record.sorts === undefined ? [] : expectSorts(record.sorts),
    filter: record.filter === undefined ? null : parseCardFilterInput(record.filter, "filter"),
  };
}

export function createCardsRoutes(options: CardsRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/workspaces/:workspaceId/tags", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    await assertUserHasWorkspaceAccess(requestContext.userId, workspaceId);
    const requestId = context.get("requestId");

    try {
      const result = await listWorkspaceTagsSummary(requestContext.userId, workspaceId);
      addBackendBreadcrumb({
        action: "workspace_tags_list",
        scope: createCardsScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId),
        details: {
          statusCode: 200,
          tagsCount: result.tags.length,
          totalCards: result.totalCards,
        },
      });
      return context.json(result satisfies WorkspaceTagsSummaryResponse);
    } catch (error) {
      const scope = createCardsScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId);
      const details = {
        tagsCount: null,
        totalCards: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "workspace_tags_list_error", error: normalizeCaughtError(error), scope, details },
        { action: "workspace_tags_list_error", scope, details },
      );
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/cards/query", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    await assertUserHasWorkspaceAccess(requestContext.userId, workspaceId);
    const body = parseQueryCardsRequestBody(await parseJsonBody(context.req.raw));
    const requestId = context.get("requestId");

    try {
      const result = await queryCardsPage(requestContext.userId, workspaceId, body);
      addBackendBreadcrumb({
        action: "cards_query",
        scope: createCardsScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId),
        details: {
          statusCode: 200,
          limit: body.limit,
          sortsCount: body.sorts.length,
          hasSearch: body.searchText !== null,
          hasFilter: body.filter !== null,
          resultsCount: result.cards.length,
          totalCount: result.totalCount,
          hasMore: result.nextCursor !== null,
        },
      });
      return context.json(result);
    } catch (error) {
      const scope = createCardsScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId);
      const details = {
        limit: body.limit,
        sortsCount: body.sorts.length,
        hasSearch: body.searchText !== null,
        hasFilter: body.filter !== null,
        resultsCount: null,
        totalCount: null,
        hasMore: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "cards_query_error", error: normalizeCaughtError(error), scope, details },
        { action: "cards_query_error", scope, details },
      );
      throw error;
    }
  });

  return app;
}
