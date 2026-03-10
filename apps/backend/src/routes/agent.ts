import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import {
  createCards,
  deleteCards,
  getCards,
  listCards,
  listReviewHistory,
  listReviewQueue,
  searchCards,
  summarizeDeckState,
  updateCards,
  type BulkCreateCardItem,
  type BulkDeleteCardItem,
  type BulkUpdateCardItem,
  type CreateCardInput,
  type EffortLevel,
  type UpdateCardInput,
} from "../cards";
import {
  buildAgentNextStepsInstructions,
  buildAgentToolCatalog,
  createAgentCreateWorkspaceAction,
  createAgentEnvelope,
  createAgentErrorEnvelope,
  createAgentListToolsAction,
  createAgentListWorkspacesAction,
  createAgentLoadAccountAction,
  createAgentOpenApiAction,
  createAgentSelectWorkspaceAction,
  createAgentToolAction,
  type AgentAction,
} from "../agentEnvelope";
import { ensureAgentSyncDevice } from "../agentSyncIdentity";
import {
  EXTERNAL_AGENT_TOOL_DEFINITIONS,
  EXTERNAL_AGENT_TOOL_MAX_RESULT_COUNT,
  type ExternalAgentToolName,
} from "../externalAgentTools";
import {
  createAgentAccountEnvelope,
  createAgentWorkspaceReadyEnvelope,
  createAgentWorkspacesEnvelope,
} from "../agentSetup";
import {
  createDecks,
  deleteDecks,
  getDecks,
  listDecks,
  searchDecks,
  updateDecks,
  type BulkCreateDeckItem,
  type BulkDeleteDeckItem,
  type BulkUpdateDeckItem,
  type CreateDeckInput,
  type UpdateDeckInput,
} from "../decks";
import { HttpError } from "../errors";
import { loadOpenApiDocument } from "../openapi";
import { getWorkspaceSchedulerSettings } from "../workspaceSchedulerSettings";
import {
  assertUserHasWorkspaceAccess,
  createWorkspaceForUser,
  listUserWorkspaces,
  selectWorkspaceForUser,
  type WorkspaceSummary,
} from "../workspaces";
import { OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS } from "../chat/openai/localTools";
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

type AgentLimitInput = Readonly<{
  limit: number | null;
}>;

type AgentGetCardsInput = Readonly<{
  cardIds: ReadonlyArray<string>;
}>;

type AgentSearchCardsInput = Readonly<{
  query: string;
  limit: number | null;
}>;

type AgentGetDecksInput = Readonly<{
  deckIds: ReadonlyArray<string>;
}>;

type AgentSearchDecksInput = Readonly<{
  query: string;
  limit: number | null;
}>;

type AgentListReviewHistoryInput = Readonly<{
  limit: number | null;
  cardId: string | null;
}>;

type AgentCreateCardBody = Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
}>;

type AgentUpdateCardBody = Readonly<{
  cardId: string;
  frontText: string | null;
  backText: string | null;
  tags: ReadonlyArray<string> | null;
  effortLevel: EffortLevel | null;
}>;

type AgentCreateCardsInput = Readonly<{
  cards: ReadonlyArray<AgentCreateCardBody>;
}>;

type AgentUpdateCardsInput = Readonly<{
  updates: ReadonlyArray<AgentUpdateCardBody>;
}>;

type AgentDeleteCardsInput = Readonly<{
  cardIds: ReadonlyArray<string>;
}>;

type AgentCreateDeckBody = Readonly<{
  name: string;
  effortLevels: ReadonlyArray<EffortLevel>;
  tags: ReadonlyArray<string>;
}>;

type AgentUpdateDeckBody = Readonly<{
  deckId: string;
  name: string | null;
  effortLevels: ReadonlyArray<EffortLevel> | null;
  tags: ReadonlyArray<string> | null;
}>;

type AgentCreateDecksInput = Readonly<{
  decks: ReadonlyArray<AgentCreateDeckBody>;
}>;

type AgentUpdateDecksInput = Readonly<{
  updates: ReadonlyArray<AgentUpdateDeckBody>;
}>;

type AgentDeleteDecksInput = Readonly<{
  deckIds: ReadonlyArray<string>;
}>;

type AgentMutationContext = Readonly<{
  workspaceId: string;
  userId: string;
  connectionId: string;
  actionName: ExternalAgentToolName;
}>;

function normalizeAgentToolLimit(limit: number | null): number {
  return limit ?? EXTERNAL_AGENT_TOOL_MAX_RESULT_COUNT;
}

function parseAgentToolBody<T>(toolName: ExternalAgentToolName, value: unknown): T {
  const validator = OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS[toolName];
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
    toolName === "list_cards"
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

async function loadSelectedWorkspaceSummary(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceSummary> {
  const workspaces = await listUserWorkspaces(userId);
  const selectedWorkspace = workspaces.find((workspace) => workspace.workspaceId === workspaceId);
  if (selectedWorkspace === undefined) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }

  return selectedWorkspace;
}

function createMutationOperationId(
  actionName: ExternalAgentToolName,
  index: number,
): string {
  return `${actionName}-${index}-${randomUUID()}`;
}

async function buildCardMutationContextMetadata(
  context: AgentMutationContext,
  count: number,
): Promise<ReadonlyArray<Readonly<{
  clientUpdatedAt: string;
  lastModifiedByDeviceId: string;
  lastOperationId: string;
}>>> {
  const deviceId = await ensureAgentSyncDevice(context.workspaceId, context.userId, context.connectionId);
  const clientUpdatedAt = new Date().toISOString();

  return Array.from({ length: count }, (_, index) => ({
    clientUpdatedAt,
    lastModifiedByDeviceId: deviceId,
    lastOperationId: createMutationOperationId(context.actionName, index),
  }));
}

function toCreateCardInput(item: AgentCreateCardBody): CreateCardInput {
  return {
    frontText: item.frontText,
    backText: item.backText,
    tags: item.tags,
    effortLevel: item.effortLevel,
  };
}

function toUpdateCardInput(item: AgentUpdateCardBody): UpdateCardInput {
  return {
    ...(item.frontText !== null ? { frontText: item.frontText } : {}),
    ...(item.backText !== null ? { backText: item.backText } : {}),
    ...(item.tags !== null ? { tags: item.tags } : {}),
    ...(item.effortLevel !== null ? { effortLevel: item.effortLevel } : {}),
  };
}

function toCreateDeckInput(item: AgentCreateDeckBody): CreateDeckInput {
  return {
    name: item.name,
    filterDefinition: {
      version: 2,
      effortLevels: item.effortLevels,
      tags: item.tags,
    },
  };
}

function toUpdateDeckInput(item: AgentUpdateDeckBody, currentDeck: Readonly<{
  name: string;
  filterDefinition: Readonly<{
    effortLevels: ReadonlyArray<EffortLevel>;
    tags: ReadonlyArray<string>;
  }>;
}>): UpdateDeckInput {
  return {
    name: item.name ?? currentDeck.name,
    filterDefinition: {
      version: 2,
      effortLevels: item.effortLevels ?? currentDeck.filterDefinition.effortLevels,
      tags: item.tags ?? currentDeck.filterDefinition.tags,
    },
  };
}

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
    const workspaces = await listUserWorkspaces(requestContext.userId);
    return context.json(createAgentWorkspacesEnvelope(context.req.url, workspaces));
  });

  app.post("/agent/workspaces", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const body = expectRecord(await parseJsonBody(context.req.raw));
    const workspace = await createWorkspaceForUser(requestContext.userId, expectNonEmptyString(body.name, "name"));
    return context.json(createAgentWorkspaceReadyEnvelope(context.req.url, workspace), 201);
  });

  app.post("/agent/workspaces/:workspaceId/select", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const workspace = await selectWorkspaceForUser(requestContext.userId, workspaceId);
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
    const workspace = await loadSelectedWorkspaceSummary(requestContext.userId, workspaceId);
    const deckSummary = await summarizeDeckState(workspaceId);
    const schedulerSettings = await getWorkspaceSchedulerSettings(workspaceId);
    const actions = toAgentToolActions(context.req.url, "get_workspace_context");

    return context.json(createAgentEnvelope(
      context.req.url,
      {
        workspace,
        deckSummary,
        schedulerSettings,
      },
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/list_cards", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentLimitInput>("list_cards", await parseJsonBody(context.req.raw));
    const limitApplied = normalizeAgentToolLimit(body.limit);
    const cards = await listCards(workspaceId);
    const actions = toAgentToolActions(context.req.url, "list_cards");

    return context.json(createAgentEnvelope(
      context.req.url,
      {
        cards: cards.slice(0, limitApplied),
        returnedCount: Math.min(cards.length, limitApplied),
        hasMore: cards.length > limitApplied,
        limitApplied,
      },
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/get_cards", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentGetCardsInput>("get_cards", await parseJsonBody(context.req.raw));
    const cards = await getCards(workspaceId, body.cardIds);
    const actions = toAgentToolActions(context.req.url, "get_cards");

    return context.json(createAgentEnvelope(
      context.req.url,
      {
        cards,
        returnedCount: cards.length,
      },
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/search_cards", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentSearchCardsInput>("search_cards", await parseJsonBody(context.req.raw));
    const limitApplied = normalizeAgentToolLimit(body.limit);
    const cards = await searchCards(workspaceId, body.query, limitApplied);
    const actions = toAgentToolActions(context.req.url, "search_cards");

    return context.json(createAgentEnvelope(
      context.req.url,
      {
        cards,
        returnedCount: cards.length,
        hasMore: cards.length === limitApplied,
        limitApplied,
      },
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/list_due_cards", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentLimitInput>("list_due_cards", await parseJsonBody(context.req.raw));
    const limitApplied = normalizeAgentToolLimit(body.limit);
    const cards = await listReviewQueue(workspaceId, limitApplied);
    const actions = toAgentToolActions(context.req.url, "list_due_cards");

    return context.json(createAgentEnvelope(
      context.req.url,
      {
        cards,
        returnedCount: cards.length,
        hasMore: cards.length === limitApplied,
        limitApplied,
      },
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/list_decks", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const decks = await listDecks(workspaceId);
    const actions = toAgentToolActions(context.req.url, "list_decks");

    return context.json(createAgentEnvelope(
      context.req.url,
      {
        decks: decks.slice(0, EXTERNAL_AGENT_TOOL_MAX_RESULT_COUNT),
        returnedCount: Math.min(decks.length, EXTERNAL_AGENT_TOOL_MAX_RESULT_COUNT),
        hasMore: decks.length > EXTERNAL_AGENT_TOOL_MAX_RESULT_COUNT,
        limitApplied: EXTERNAL_AGENT_TOOL_MAX_RESULT_COUNT,
      },
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/get_decks", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentGetDecksInput>("get_decks", await parseJsonBody(context.req.raw));
    const decks = await getDecks(workspaceId, body.deckIds);
    const actions = toAgentToolActions(context.req.url, "get_decks");

    return context.json(createAgentEnvelope(
      context.req.url,
      {
        decks,
        returnedCount: decks.length,
      },
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/search_decks", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentSearchDecksInput>("search_decks", await parseJsonBody(context.req.raw));
    const limitApplied = normalizeAgentToolLimit(body.limit);
    const decks = await searchDecks(workspaceId, body.query, limitApplied);
    const actions = toAgentToolActions(context.req.url, "search_decks");

    return context.json(createAgentEnvelope(
      context.req.url,
      {
        decks,
        returnedCount: decks.length,
        hasMore: decks.length === limitApplied,
        limitApplied,
      },
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/list_review_history", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentListReviewHistoryInput>(
      "list_review_history",
      await parseJsonBody(context.req.raw),
    );
    const limitApplied = normalizeAgentToolLimit(body.limit);
    const history = body.cardId === null
      ? await listReviewHistory(workspaceId, limitApplied)
      : await listReviewHistory(workspaceId, limitApplied, body.cardId);
    const actions = toAgentToolActions(context.req.url, "list_review_history");

    return context.json(createAgentEnvelope(
      context.req.url,
      {
        history,
        returnedCount: history.length,
        hasMore: history.length === limitApplied,
        limitApplied,
      },
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/get_scheduler_settings", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const schedulerSettings = await getWorkspaceSchedulerSettings(workspaceId);
    const actions = toAgentToolActions(context.req.url, "get_scheduler_settings");

    return context.json(createAgentEnvelope(
      context.req.url,
      {
        schedulerSettings,
      },
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/create_cards", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentCreateCardsInput>("create_cards", await parseJsonBody(context.req.raw));
    const metadata = await buildCardMutationContextMetadata({
      workspaceId,
      userId: requestContext.userId,
      connectionId,
      actionName: "create_cards",
    }, body.cards.length);
    const items: ReadonlyArray<BulkCreateCardItem> = body.cards.map((card, index) => ({
      input: toCreateCardInput(card),
      metadata: metadata[index],
    }));
    const cards = await createCards(workspaceId, items);
    const actions = toAgentToolActions(context.req.url, "create_cards");

    return context.json(createAgentEnvelope(
      context.req.url,
      {
        cards,
        createdCount: cards.length,
      },
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/update_cards", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentUpdateCardsInput>("update_cards", await parseJsonBody(context.req.raw));
    const metadata = await buildCardMutationContextMetadata({
      workspaceId,
      userId: requestContext.userId,
      connectionId,
      actionName: "update_cards",
    }, body.updates.length);
    const items: ReadonlyArray<BulkUpdateCardItem> = body.updates.map((update, index) => ({
      cardId: update.cardId,
      input: toUpdateCardInput(update),
      metadata: metadata[index],
    }));
    const cards = await updateCards(workspaceId, items);
    const actions = toAgentToolActions(context.req.url, "update_cards");

    return context.json(createAgentEnvelope(
      context.req.url,
      {
        cards,
        updatedCount: cards.length,
      },
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/delete_cards", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentDeleteCardsInput>("delete_cards", await parseJsonBody(context.req.raw));
    const metadata = await buildCardMutationContextMetadata({
      workspaceId,
      userId: requestContext.userId,
      connectionId,
      actionName: "delete_cards",
    }, body.cardIds.length);
    const items: ReadonlyArray<BulkDeleteCardItem> = body.cardIds.map((cardId, index) => ({
      cardId,
      metadata: metadata[index],
    }));
    const result = await deleteCards(workspaceId, items);
    const actions = toAgentToolActions(context.req.url, "delete_cards");

    return context.json(createAgentEnvelope(
      context.req.url,
      result,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/create_decks", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentCreateDecksInput>("create_decks", await parseJsonBody(context.req.raw));
    const metadata = await buildCardMutationContextMetadata({
      workspaceId,
      userId: requestContext.userId,
      connectionId,
      actionName: "create_decks",
    }, body.decks.length);
    const items: ReadonlyArray<BulkCreateDeckItem> = body.decks.map((deck, index) => ({
      input: toCreateDeckInput(deck),
      metadata: metadata[index],
    }));
    const decks = await createDecks(workspaceId, items);
    const actions = toAgentToolActions(context.req.url, "create_decks");

    return context.json(createAgentEnvelope(
      context.req.url,
      {
        decks,
        createdCount: decks.length,
      },
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/update_decks", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentUpdateDecksInput>("update_decks", await parseJsonBody(context.req.raw));
    const currentDecks = await getDecks(workspaceId, body.updates.map((update) => update.deckId));
    const currentDeckById = new Map(currentDecks.map((deck) => [deck.deckId, deck] as const));
    const metadata = await buildCardMutationContextMetadata({
      workspaceId,
      userId: requestContext.userId,
      connectionId,
      actionName: "update_decks",
    }, body.updates.length);
    const items: ReadonlyArray<BulkUpdateDeckItem> = body.updates.map((update, index) => {
      const currentDeck = currentDeckById.get(update.deckId);
      if (currentDeck === undefined) {
        throw new HttpError(404, `Deck not found: ${update.deckId}`);
      }

      return {
        deckId: update.deckId,
        input: toUpdateDeckInput(update, currentDeck),
        metadata: metadata[index],
      };
    });
    const decks = await updateDecks(workspaceId, items);
    const actions = toAgentToolActions(context.req.url, "update_decks");

    return context.json(createAgentEnvelope(
      context.req.url,
      {
        decks,
        updatedCount: decks.length,
      },
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  app.post("/agent/tools/delete_decks", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseAgentToolBody<AgentDeleteDecksInput>("delete_decks", await parseJsonBody(context.req.raw));
    const metadata = await buildCardMutationContextMetadata({
      workspaceId,
      userId: requestContext.userId,
      connectionId,
      actionName: "delete_decks",
    }, body.deckIds.length);
    const items: ReadonlyArray<BulkDeleteDeckItem> = body.deckIds.map((deckId, index) => ({
      deckId,
      metadata: metadata[index],
    }));
    const result = await deleteDecks(workspaceId, items);
    const actions = toAgentToolActions(context.req.url, "delete_decks");

    return context.json(createAgentEnvelope(
      context.req.url,
      result,
      actions,
      buildAgentNextStepsInstructions(actions),
    ));
  });

  return app;
}
