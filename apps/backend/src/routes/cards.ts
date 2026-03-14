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
import { HttpError } from "../errors";
import {
  loadRequestContextFromRequest,
  parseWorkspaceIdParam,
} from "../server/requestContext";
import {
  expectNullableNonEmptyString,
  expectRecord,
  parseJsonBody,
} from "../server/requestParsing";
import {
  logCloudRouteEvent,
  summarizeValidationIssues,
} from "../server/logging";
import { assertUserHasWorkspaceAccess } from "../workspaces";
import type { AppEnv } from "../app";

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

function getInternalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
      logCloudRouteEvent("workspace_tags_list", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        workspaceId,
        tagsCount: result.tags.length,
        totalCards: result.totalCards,
      }, false);
      return context.json(result satisfies WorkspaceTagsSummaryResponse);
    } catch (error) {
      logCloudRouteEvent("workspace_tags_list_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        workspaceId,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        message: getInternalErrorMessage(error),
        validationIssues: summarizeValidationIssues(error),
      }, true);
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
      logCloudRouteEvent("cards_query", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        workspaceId,
        limit: body.limit,
        sortsCount: body.sorts.length,
        hasSearch: body.searchText !== null,
        hasFilter: body.filter !== null,
        resultsCount: result.cards.length,
        totalCount: result.totalCount,
        hasMore: result.nextCursor !== null,
      }, false);
      return context.json(result);
    } catch (error) {
      logCloudRouteEvent("cards_query_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        workspaceId,
        limit: body.limit,
        sortsCount: body.sorts.length,
        hasSearch: body.searchText !== null,
        hasFilter: body.filter !== null,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        message: getInternalErrorMessage(error),
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  return app;
}
