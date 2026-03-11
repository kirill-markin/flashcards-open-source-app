import { Hono } from "hono";
import {
  buildAgentNextStepsInstructions,
  buildAgentToolCatalog,
  createAgentEnvelope,
  createAgentListToolsAction,
  createAgentListWorkspacesAction,
  createAgentToolAction,
  type AgentAction,
} from "../agentEnvelope";
import { type ExternalAgentToolName } from "../externalAgentTools";
import {
  createAgentAccountEnvelope,
  createAgentWorkspaceReadyEnvelope,
  createAgentWorkspacesEnvelope,
} from "../agentSetup";
import { HttpError } from "../errors";
import { loadOpenApiDocument } from "../openapi";
import { parseOptionalCursorQuery, parseRequiredPageLimit } from "../pagination";
import {
  createWorkspaceForApiKeyConnection,
  listUserWorkspacesPageForSelectedWorkspace,
  selectWorkspaceForApiKeyConnection,
} from "../workspaces";
import { SHARED_AI_TOOL_ARGUMENT_VALIDATORS } from "../aiTools/sharedToolContracts";
import {
  DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
  createAgentCardsOperation,
  createAgentDecksOperation,
  deleteAgentCardsOperation,
  deleteAgentDecksOperation,
  getAgentCardsOperation,
  getAgentDecksOperation,
  getAgentSchedulerSettingsOperation,
  listAgentCardsOperation,
  listAgentDecksOperation,
  listAgentDueCardsOperation,
  listAgentReviewHistoryOperation,
  listAgentTagsOperation,
  loadAgentWorkspaceContextOperation,
  searchAgentCardsOperation,
  searchAgentDecksOperation,
  updateAgentCardsOperation,
  updateAgentDecksOperation,
} from "../aiTools/agentToolOperations";
import type {
  AgentToolCreateCardsInput,
  AgentToolCreateDecksInput,
  AgentToolDeleteCardsInput,
  AgentToolDeleteDecksInput,
  AgentToolGetCardsInput,
  AgentToolGetDecksInput,
  AgentToolCursorInput,
  AgentToolListReviewHistoryInput,
  AgentToolSearchCardsInput,
  AgentToolSearchDecksInput,
  AgentToolUpdateCardsInput,
  AgentToolUpdateDecksInput,
} from "../aiTools/sharedToolContracts";
import {
  loadRequestContextFromRequest,
  parseWorkspaceIdParam,
  requireAgentConnectionId,
  requireSelectedWorkspaceId,
} from "../server/requestContext";
import {
  expectNonEmptyString,
  expectRecord,
  parseJsonBody,
} from "../server/requestParsing";
import type { AppEnv } from "../app";

type AgentRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
}>;

function parsePageQueryInput(request: Request): Readonly<{
  cursor: string | null;
  limit: number;
}> {
  const url = new URL(request.url);
  return {
    cursor: parseOptionalCursorQuery(url.searchParams.get("cursor") ?? undefined, "cursor"),
    limit: parseRequiredPageLimit(url.searchParams.get("limit") ?? undefined, "limit", 100),
  };
}

function parseAgentToolBody<T>(toolName: ExternalAgentToolName, value: unknown): T {
  const validator = SHARED_AI_TOOL_ARGUMENT_VALIDATORS[toolName];
  const result = validator.safeParse(value);
  if (!result.success) {
    throw new HttpError(
      400,
      `Request body does not match the ${toolName} schema`,
      "AGENT_TOOL_INPUT_INVALID",
      {
        validationIssues: result.error.issues.map((issue) => ({
          path: issue.path.length > 0 ? issue.path.map((segment) => String(segment)).join(".") : "<root>",
          code: issue.code,
          message: issue.message,
        })),
      },
    );
  }

  return result.data as T;
}

function toAgentToolActions(requestUrl: string, toolName: ExternalAgentToolName): ReadonlyArray<AgentAction> {
  if (toolName === "create_cards" || toolName === "update_cards" || toolName === "delete_cards") {
    return [
      createAgentListToolsAction(requestUrl),
      createAgentToolAction(requestUrl, "get_workspace_context"),
      createAgentToolAction(requestUrl, "get_cards"),
      createAgentToolAction(requestUrl, "list_cards"),
    ];
  }

  if (toolName === "get_cards") {
    return [
      createAgentListToolsAction(requestUrl),
      createAgentToolAction(requestUrl, "get_workspace_context"),
      createAgentToolAction(requestUrl, "update_cards"),
      createAgentToolAction(requestUrl, "list_cards"),
    ];
  }

  if (
    toolName === "list_tags"
    || toolName === "list_cards"
    || toolName === "search_cards"
    || toolName === "list_due_cards"
  ) {
    return [
      createAgentListToolsAction(requestUrl),
      createAgentToolAction(requestUrl, "get_workspace_context"),
      createAgentToolAction(requestUrl, "get_cards"),
      createAgentToolAction(requestUrl, "create_cards"),
    ];
  }

  if (toolName === "create_decks" || toolName === "update_decks" || toolName === "delete_decks") {
    return [
      createAgentListToolsAction(requestUrl),
      createAgentToolAction(requestUrl, "get_workspace_context"),
      createAgentToolAction(requestUrl, "get_decks"),
      createAgentToolAction(requestUrl, "list_decks"),
    ];
  }

  if (toolName === "get_decks") {
    return [
      createAgentListToolsAction(requestUrl),
      createAgentToolAction(requestUrl, "get_workspace_context"),
      createAgentToolAction(requestUrl, "update_decks"),
      createAgentToolAction(requestUrl, "list_decks"),
    ];
  }

  if (
    toolName === "list_decks"
    || toolName === "search_decks"
  ) {
    return [
      createAgentListToolsAction(requestUrl),
      createAgentToolAction(requestUrl, "get_workspace_context"),
      createAgentToolAction(requestUrl, "get_decks"),
      createAgentToolAction(requestUrl, "search_decks"),
    ];
  }

  if (toolName === "get_scheduler_settings" || toolName === "list_review_history") {
    return [
      createAgentListToolsAction(requestUrl),
      createAgentToolAction(requestUrl, "get_workspace_context"),
      createAgentToolAction(requestUrl, "list_due_cards"),
      createAgentToolAction(requestUrl, "search_cards"),
    ];
  }

  if (toolName === "get_workspace_context") {
    return [
      createAgentListToolsAction(requestUrl),
      createAgentToolAction(requestUrl, "list_tags"),
      createAgentToolAction(requestUrl, "list_cards"),
      createAgentToolAction(requestUrl, "list_decks"),
      createAgentToolAction(requestUrl, "create_cards"),
    ];
  }

  return [
    createAgentListToolsAction(requestUrl),
    createAgentToolAction(requestUrl, "get_workspace_context"),
    createAgentToolAction(requestUrl, "search_cards"),
    createAgentToolAction(requestUrl, "create_cards"),
  ];
}

function createAgentWorkspaceActions(requestUrl: string): ReadonlyArray<AgentAction> {
  return [
    createAgentListToolsAction(requestUrl),
    createAgentToolAction(requestUrl, "get_workspace_context"),
    createAgentToolAction(requestUrl, "list_tags"),
    createAgentToolAction(requestUrl, "search_cards"),
    createAgentToolAction(requestUrl, "create_cards"),
  ];
}

async function loadAgentRequest(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
): Promise<Readonly<{
  requestContext: Awaited<ReturnType<typeof loadRequestContextFromRequest>>["requestContext"];
  connectionId: string;
}>> {
  const { requestContext } = await loadRequestContextFromRequest(request, allowedOrigins);
  const connectionId = requireAgentConnectionId(requestContext);

  return {
    requestContext,
    connectionId,
  };
}

/**
 * External-agent HTTP adapter.
 *
 * This file owns request auth, workspace selection checks, request-body
 * validation, response envelopes, and next-action hints. Canonical backend
 * tool behavior lives in `apps/backend/src/aiTools/agentToolOperations.ts`,
 * while shared TypeScript tool contracts live in
 * `apps/backend/src/aiTools/sharedToolContracts.ts`.
 */
export function createAgentRoutes(options: AgentRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/agent/openapi.json", async (context) => context.json(loadOpenApiDocument()));
  app.get("/agent/swagger.json", async (context) => context.json(loadOpenApiDocument()));

  app.get("/agent/me", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    return context.json(createAgentAccountEnvelope(context.req.url, requestContext));
  });

  app.get("/agent/workspaces", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const pageInput = parsePageQueryInput(context.req.raw);
    const workspacesPage = await listUserWorkspacesPageForSelectedWorkspace(
      requestContext.userId,
      requestContext.selectedWorkspaceId,
      pageInput,
    );
    return context.json(createAgentWorkspacesEnvelope(
      context.req.url,
      workspacesPage.workspaces,
      workspacesPage.nextCursor,
    ));
  });

  app.post("/agent/workspaces", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const body = expectRecord(await parseJsonBody(context.req.raw));
    const workspace = await createWorkspaceForApiKeyConnection(
      requestContext.userId,
      connectionId,
      expectNonEmptyString(body.name, "name"),
    );
    return context.json(createAgentWorkspaceReadyEnvelope(context.req.url, workspace), 201);
  });

  app.post("/agent/workspaces/:workspaceId/select", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const workspace = await selectWorkspaceForApiKeyConnection(requestContext.userId, connectionId, workspaceId);
    return context.json(createAgentWorkspaceReadyEnvelope(context.req.url, workspace));
  });

  app.get("/agent/tools", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const actions = requestContext.selectedWorkspaceId === null
      ? [createAgentListWorkspacesAction(context.req.url)]
      : createAgentWorkspaceActions(context.req.url);

    return context.json(createAgentEnvelope(
      context.req.url,
      {
        selectedWorkspaceId: requestContext.selectedWorkspaceId,
        tools: buildAgentToolCatalog(context.req.url),
      },
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/get_workspace_context", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const payload = await loadAgentWorkspaceContextOperation(
      DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
      {
        userId: requestContext.userId,
        workspaceId,
        selectedWorkspaceId: requestContext.selectedWorkspaceId,
      },
    );
    const actions = toAgentToolActions(context.req.url, "get_workspace_context");

    return context.json(createAgentEnvelope(
      context.req.url,
      payload,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/list_tags", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const payload = await listAgentTagsOperation(DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES, {
      workspaceId,
    });
    const actions = toAgentToolActions(context.req.url, "list_tags");

    return context.json(createAgentEnvelope(
      context.req.url,
      payload,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/list_cards", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentToolCursorInput>("list_cards", await parseJsonBody(context.req.raw));
    const payload = await listAgentCardsOperation(DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES, {
      workspaceId,
      cursor: body.cursor,
      limit: body.limit,
    });
    const actions = toAgentToolActions(context.req.url, "list_cards");

    return context.json(createAgentEnvelope(
      context.req.url,
      payload,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/get_cards", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentToolGetCardsInput>("get_cards", await parseJsonBody(context.req.raw));
    const payload = await getAgentCardsOperation(DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES, {
      workspaceId,
      cardIds: body.cardIds,
    });
    const actions = toAgentToolActions(context.req.url, "get_cards");

    return context.json(createAgentEnvelope(
      context.req.url,
      payload,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/search_cards", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentToolSearchCardsInput>("search_cards", await parseJsonBody(context.req.raw));
    const payload = await searchAgentCardsOperation(DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES, {
      workspaceId,
      query: body.query,
      cursor: body.cursor,
      limit: body.limit,
    });
    const actions = toAgentToolActions(context.req.url, "search_cards");

    return context.json(createAgentEnvelope(
      context.req.url,
      payload,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/list_due_cards", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentToolCursorInput>("list_due_cards", await parseJsonBody(context.req.raw));
    const payload = await listAgentDueCardsOperation(DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES, {
      workspaceId,
      cursor: body.cursor,
      limit: body.limit,
    });
    const actions = toAgentToolActions(context.req.url, "list_due_cards");

    return context.json(createAgentEnvelope(
      context.req.url,
      payload,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/list_decks", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentToolCursorInput>("list_decks", await parseJsonBody(context.req.raw));
    const payload = await listAgentDecksOperation(DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES, {
      workspaceId,
      cursor: body.cursor,
      limit: body.limit,
    });
    const actions = toAgentToolActions(context.req.url, "list_decks");

    return context.json(createAgentEnvelope(
      context.req.url,
      payload,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/get_decks", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentToolGetDecksInput>("get_decks", await parseJsonBody(context.req.raw));
    const payload = await getAgentDecksOperation(DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES, {
      workspaceId,
      deckIds: body.deckIds,
    });
    const actions = toAgentToolActions(context.req.url, "get_decks");

    return context.json(createAgentEnvelope(
      context.req.url,
      payload,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/search_decks", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentToolSearchDecksInput>("search_decks", await parseJsonBody(context.req.raw));
    const payload = await searchAgentDecksOperation(DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES, {
      workspaceId,
      query: body.query,
      cursor: body.cursor,
      limit: body.limit,
    });
    const actions = toAgentToolActions(context.req.url, "search_decks");

    return context.json(createAgentEnvelope(
      context.req.url,
      payload,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/list_review_history", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentToolListReviewHistoryInput>(
      "list_review_history",
      await parseJsonBody(context.req.raw),
    );
    const payload = await listAgentReviewHistoryOperation(DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES, {
      workspaceId,
      cursor: body.cursor,
      limit: body.limit,
      cardId: body.cardId,
    });
    const actions = toAgentToolActions(context.req.url, "list_review_history");

    return context.json(createAgentEnvelope(
      context.req.url,
      payload,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/get_scheduler_settings", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const payload = await getAgentSchedulerSettingsOperation(DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES, {
      workspaceId,
    });
    const actions = toAgentToolActions(context.req.url, "get_scheduler_settings");

    return context.json(createAgentEnvelope(
      context.req.url,
      payload,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/create_cards", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentToolCreateCardsInput>("create_cards", await parseJsonBody(context.req.raw));
    const payload = await createAgentCardsOperation(DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES, {
      workspaceId,
      userId: requestContext.userId,
      connectionId,
      actionName: "create_cards",
      cards: body.cards,
    });
    const actions = toAgentToolActions(context.req.url, "create_cards");

    return context.json(createAgentEnvelope(
      context.req.url,
      payload,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/update_cards", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentToolUpdateCardsInput>("update_cards", await parseJsonBody(context.req.raw));
    const payload = await updateAgentCardsOperation(DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES, {
      workspaceId,
      userId: requestContext.userId,
      connectionId,
      actionName: "update_cards",
      updates: body.updates,
    });
    const actions = toAgentToolActions(context.req.url, "update_cards");

    return context.json(createAgentEnvelope(
      context.req.url,
      payload,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/delete_cards", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentToolDeleteCardsInput>("delete_cards", await parseJsonBody(context.req.raw));
    const payload = await deleteAgentCardsOperation(DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES, {
      workspaceId,
      userId: requestContext.userId,
      connectionId,
      actionName: "delete_cards",
      cardIds: body.cardIds,
    });
    const actions = toAgentToolActions(context.req.url, "delete_cards");

    return context.json(createAgentEnvelope(
      context.req.url,
      payload,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/create_decks", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentToolCreateDecksInput>("create_decks", await parseJsonBody(context.req.raw));
    const payload = await createAgentDecksOperation(DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES, {
      workspaceId,
      userId: requestContext.userId,
      connectionId,
      actionName: "create_decks",
      decks: body.decks,
    });
    const actions = toAgentToolActions(context.req.url, "create_decks");

    return context.json(createAgentEnvelope(
      context.req.url,
      payload,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/update_decks", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentToolUpdateDecksInput>("update_decks", await parseJsonBody(context.req.raw));
    const payload = await updateAgentDecksOperation(DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES, {
      workspaceId,
      userId: requestContext.userId,
      connectionId,
      actionName: "update_decks",
      updates: body.updates,
    });
    const actions = toAgentToolActions(context.req.url, "update_decks");

    return context.json(createAgentEnvelope(
      context.req.url,
      payload,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/delete_decks", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentToolDeleteDecksInput>("delete_decks", await parseJsonBody(context.req.raw));
    const payload = await deleteAgentDecksOperation(DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES, {
      workspaceId,
      userId: requestContext.userId,
      connectionId,
      actionName: "delete_decks",
      deckIds: body.deckIds,
    });
    const actions = toAgentToolActions(context.req.url, "delete_decks");

    return context.json(createAgentEnvelope(
      context.req.url,
      payload,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  return app;
}
