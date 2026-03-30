import type {
  AgentApiKeyConnection,
  ChatConfig,
  ChatSessionHistoryMessage,
  ChatSessionSnapshot,
  ChatTranscriptionResponse,
  ContentPart,
  Deck,
  DeckFilterDefinition,
  DeleteWorkspaceResponse,
  QueryCardsPage,
  ResetChatSessionResponse,
  ReviewEvent,
  SessionInfo,
  StartChatRunResponse,
  StopChatRunResponse,
  SyncBootstrapEntry,
  SyncBootstrapPullResult,
  SyncBootstrapPushResult,
  SyncChange,
  SyncPullResult,
  SyncPushResult,
  SyncReviewHistoryImportResult,
  SyncReviewHistoryPullResult,
  WorkspaceDeletePreview,
  WorkspaceSchedulerSettings,
  WorkspaceSummary,
  Card,
} from "./types";

type JsonObject = Readonly<Record<string, unknown>>;
type LiteralValue = string | number | boolean | null;
type ValueParser<ParsedValue> = (value: unknown, endpoint: string, path: string) => ParsedValue;

export type WorkspacesEnvelope = Readonly<{
  workspaces: ReadonlyArray<WorkspaceSummary>;
  nextCursor: string | null;
}>;

export type WorkspaceEnvelope = Readonly<{
  workspace: WorkspaceSummary;
}>;

export type AgentApiKeyConnectionsEnvelope = Readonly<{
  connections: ReadonlyArray<AgentApiKeyConnection>;
  instructions: string;
  nextCursor: string | null;
}>;

export class ApiContractError extends Error {
  readonly endpoint: string;
  readonly fieldPath: string;
  readonly expected: string;

  constructor(endpoint: string, fieldPath: string, expected: string) {
    super(`Invalid API response for ${endpoint}: ${fieldPath} must be ${expected}`);
    this.name = "ApiContractError";
    this.endpoint = endpoint;
    this.fieldPath = fieldPath;
    this.expected = expected;
  }
}

function joinPath(parentPath: string, key: string): string {
  return parentPath === "" ? key : `${parentPath}.${key}`;
}

function joinIndexPath(parentPath: string, index: number): string {
  return `${parentPath}[${index}]`;
}

function describePath(path: string): string {
  return path === "" ? "response" : path;
}

function hasOwn(objectValue: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(objectValue, key);
}

function parseString(value: unknown, endpoint: string, path: string): string {
  if (typeof value !== "string") {
    throw new ApiContractError(endpoint, describePath(path), "string");
  }

  return value;
}

function parseNullableString(value: unknown, endpoint: string, path: string): string | null {
  if (value === null) {
    return null;
  }

  return parseString(value, endpoint, path);
}

function parseNumber(value: unknown, endpoint: string, path: string): number {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    throw new ApiContractError(endpoint, describePath(path), "number");
  }

  return value;
}

function parseNullableNumber(value: unknown, endpoint: string, path: string): number | null {
  if (value === null) {
    return null;
  }

  return parseNumber(value, endpoint, path);
}

function parseBoolean(value: unknown, endpoint: string, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new ApiContractError(endpoint, describePath(path), "boolean");
  }

  return value;
}

function parseObject(value: unknown, endpoint: string, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiContractError(endpoint, describePath(path), "object");
  }

  return value as JsonObject;
}

function parseArray<ParsedValue>(
  value: unknown,
  endpoint: string,
  path: string,
  parseItem: ValueParser<ParsedValue>,
): ReadonlyArray<ParsedValue> {
  if (Array.isArray(value) === false) {
    throw new ApiContractError(endpoint, describePath(path), "array");
  }

  return value.map((item: unknown, index: number): ParsedValue => parseItem(item, endpoint, joinIndexPath(path, index)));
}

function parseLiteral<ExpectedValue extends LiteralValue>(
  value: unknown,
  endpoint: string,
  path: string,
  expectedValue: ExpectedValue,
): ExpectedValue {
  if (value !== expectedValue) {
    throw new ApiContractError(endpoint, describePath(path), JSON.stringify(expectedValue));
  }

  return expectedValue;
}

function parseEnum<EnumValue extends string | number>(
  value: unknown,
  endpoint: string,
  path: string,
  allowedValues: ReadonlyArray<EnumValue>,
): EnumValue {
  if (allowedValues.includes(value as EnumValue) === false) {
    const expected = `one of ${allowedValues.map((allowedValue: EnumValue): string => JSON.stringify(allowedValue)).join(", ")}`;
    throw new ApiContractError(endpoint, describePath(path), expected);
  }

  return value as EnumValue;
}

function parseRequiredField<ParsedValue>(
  objectValue: JsonObject,
  key: string,
  endpoint: string,
  parentPath: string,
  parseValue: ValueParser<ParsedValue>,
): ParsedValue {
  return parseValue(objectValue[key], endpoint, joinPath(parentPath, key));
}

function parseOptionalField<ParsedValue>(
  objectValue: JsonObject,
  key: string,
  endpoint: string,
  parentPath: string,
  parseValue: ValueParser<ParsedValue>,
): ParsedValue | undefined {
  if (hasOwn(objectValue, key) === false) {
    return undefined;
  }

  return parseValue(objectValue[key], endpoint, joinPath(parentPath, key));
}

function parseStringArray(value: unknown, endpoint: string, path: string): ReadonlyArray<string> {
  return parseArray(value, endpoint, path, parseString);
}

function parseNumberArray(value: unknown, endpoint: string, path: string): ReadonlyArray<number> {
  return parseArray(value, endpoint, path, parseNumber);
}

function parseWorkspaceSummary(value: unknown, endpoint: string, path: string): WorkspaceSummary {
  const objectValue = parseObject(value, endpoint, path);
  return {
    workspaceId: parseRequiredField(objectValue, "workspaceId", endpoint, path, parseString),
    name: parseRequiredField(objectValue, "name", endpoint, path, parseString),
    createdAt: parseRequiredField(objectValue, "createdAt", endpoint, path, parseString),
    isSelected: parseRequiredField(objectValue, "isSelected", endpoint, path, parseBoolean),
  };
}

function parseDeckFilterDefinition(value: unknown, endpoint: string, path: string): DeckFilterDefinition {
  const objectValue = parseObject(value, endpoint, path);
  return {
    version: parseLiteral(parseRequiredField(objectValue, "version", endpoint, path, parseNumber), endpoint, joinPath(path, "version"), 2),
    effortLevels: parseRequiredField(objectValue, "effortLevels", endpoint, path, parseEffortLevels),
    tags: parseRequiredField(objectValue, "tags", endpoint, path, parseStringArray),
  };
}

function parseCard(value: unknown, endpoint: string, path: string): Card {
  const objectValue = parseObject(value, endpoint, path);
  return {
    cardId: parseRequiredField(objectValue, "cardId", endpoint, path, parseString),
    frontText: parseRequiredField(objectValue, "frontText", endpoint, path, parseString),
    backText: parseRequiredField(objectValue, "backText", endpoint, path, parseString),
    tags: parseRequiredField(objectValue, "tags", endpoint, path, parseStringArray),
    effortLevel: parseRequiredField(objectValue, "effortLevel", endpoint, path, parseEffortLevel),
    dueAt: parseRequiredField(objectValue, "dueAt", endpoint, path, parseNullableString),
    createdAt: parseRequiredField(objectValue, "createdAt", endpoint, path, parseString),
    reps: parseRequiredField(objectValue, "reps", endpoint, path, parseNumber),
    lapses: parseRequiredField(objectValue, "lapses", endpoint, path, parseNumber),
    fsrsCardState: parseRequiredField(objectValue, "fsrsCardState", endpoint, path, parseFsrsCardState),
    fsrsStepIndex: parseRequiredField(objectValue, "fsrsStepIndex", endpoint, path, parseNullableNumber),
    fsrsStability: parseRequiredField(objectValue, "fsrsStability", endpoint, path, parseNullableNumber),
    fsrsDifficulty: parseRequiredField(objectValue, "fsrsDifficulty", endpoint, path, parseNullableNumber),
    fsrsLastReviewedAt: parseRequiredField(objectValue, "fsrsLastReviewedAt", endpoint, path, parseNullableString),
    fsrsScheduledDays: parseRequiredField(objectValue, "fsrsScheduledDays", endpoint, path, parseNullableNumber),
    clientUpdatedAt: parseRequiredField(objectValue, "clientUpdatedAt", endpoint, path, parseString),
    lastModifiedByReplicaId: parseRequiredField(objectValue, "lastModifiedByReplicaId", endpoint, path, parseString),
    lastOperationId: parseRequiredField(objectValue, "lastOperationId", endpoint, path, parseString),
    updatedAt: parseRequiredField(objectValue, "updatedAt", endpoint, path, parseString),
    deletedAt: parseRequiredField(objectValue, "deletedAt", endpoint, path, parseNullableString),
  };
}

function parseWorkspaceSchedulerSettings(
  value: unknown,
  endpoint: string,
  path: string,
): WorkspaceSchedulerSettings {
  const objectValue = parseObject(value, endpoint, path);
  return {
    algorithm: parseLiteral(
      parseRequiredField(objectValue, "algorithm", endpoint, path, parseString),
      endpoint,
      joinPath(path, "algorithm"),
      "fsrs-6",
    ),
    desiredRetention: parseRequiredField(objectValue, "desiredRetention", endpoint, path, parseNumber),
    learningStepsMinutes: parseRequiredField(objectValue, "learningStepsMinutes", endpoint, path, parseNumberArray),
    relearningStepsMinutes: parseRequiredField(objectValue, "relearningStepsMinutes", endpoint, path, parseNumberArray),
    maximumIntervalDays: parseRequiredField(objectValue, "maximumIntervalDays", endpoint, path, parseNumber),
    enableFuzz: parseRequiredField(objectValue, "enableFuzz", endpoint, path, parseBoolean),
    clientUpdatedAt: parseRequiredField(objectValue, "clientUpdatedAt", endpoint, path, parseString),
    lastModifiedByReplicaId: parseRequiredField(objectValue, "lastModifiedByReplicaId", endpoint, path, parseString),
    lastOperationId: parseRequiredField(objectValue, "lastOperationId", endpoint, path, parseString),
    updatedAt: parseRequiredField(objectValue, "updatedAt", endpoint, path, parseString),
  };
}

function parseDeck(value: unknown, endpoint: string, path: string): Deck {
  const objectValue = parseObject(value, endpoint, path);
  return {
    deckId: parseRequiredField(objectValue, "deckId", endpoint, path, parseString),
    workspaceId: parseRequiredField(objectValue, "workspaceId", endpoint, path, parseString),
    name: parseRequiredField(objectValue, "name", endpoint, path, parseString),
    filterDefinition: parseRequiredField(objectValue, "filterDefinition", endpoint, path, parseDeckFilterDefinition),
    createdAt: parseRequiredField(objectValue, "createdAt", endpoint, path, parseString),
    clientUpdatedAt: parseRequiredField(objectValue, "clientUpdatedAt", endpoint, path, parseString),
    lastModifiedByReplicaId: parseRequiredField(objectValue, "lastModifiedByReplicaId", endpoint, path, parseString),
    lastOperationId: parseRequiredField(objectValue, "lastOperationId", endpoint, path, parseString),
    updatedAt: parseRequiredField(objectValue, "updatedAt", endpoint, path, parseString),
    deletedAt: parseRequiredField(objectValue, "deletedAt", endpoint, path, parseNullableString),
  };
}

function parseReviewEvent(value: unknown, endpoint: string, path: string): ReviewEvent {
  const objectValue = parseObject(value, endpoint, path);
  return {
    reviewEventId: parseRequiredField(objectValue, "reviewEventId", endpoint, path, parseString),
    workspaceId: parseRequiredField(objectValue, "workspaceId", endpoint, path, parseString),
    cardId: parseRequiredField(objectValue, "cardId", endpoint, path, parseString),
    replicaId: parseRequiredField(objectValue, "replicaId", endpoint, path, parseString),
    clientEventId: parseRequiredField(objectValue, "clientEventId", endpoint, path, parseString),
    rating: parseRequiredField(objectValue, "rating", endpoint, path, parseReviewRating),
    reviewedAtClient: parseRequiredField(objectValue, "reviewedAtClient", endpoint, path, parseString),
    reviewedAtServer: parseRequiredField(objectValue, "reviewedAtServer", endpoint, path, parseString),
  };
}

function parseSyncBootstrapEntry(value: unknown, endpoint: string, path: string): SyncBootstrapEntry {
  const objectValue = parseObject(value, endpoint, path);
  const entityType = parseRequiredField(objectValue, "entityType", endpoint, path, parseSyncBootstrapEntityType);
  const action = parseLiteral(
    parseRequiredField(objectValue, "action", endpoint, path, parseString),
    endpoint,
    joinPath(path, "action"),
    "upsert",
  );

  if (entityType === "card") {
    return {
      entityType,
      entityId: parseRequiredField(objectValue, "entityId", endpoint, path, parseString),
      action,
      payload: parseRequiredField(objectValue, "payload", endpoint, path, parseCard),
    };
  }

  if (entityType === "deck") {
    return {
      entityType,
      entityId: parseRequiredField(objectValue, "entityId", endpoint, path, parseString),
      action,
      payload: parseRequiredField(objectValue, "payload", endpoint, path, parseDeck),
    };
  }

  return {
    entityType,
    entityId: parseRequiredField(objectValue, "entityId", endpoint, path, parseString),
    action,
    payload: parseRequiredField(objectValue, "payload", endpoint, path, parseWorkspaceSchedulerSettings),
  };
}

function parseSyncChange(value: unknown, endpoint: string, path: string): SyncChange {
  const objectValue = parseObject(value, endpoint, path);
  const entityType = parseRequiredField(objectValue, "entityType", endpoint, path, parseSyncBootstrapEntityType);
  const action = parseLiteral(
    parseRequiredField(objectValue, "action", endpoint, path, parseString),
    endpoint,
    joinPath(path, "action"),
    "upsert",
  );
  const changeId = parseRequiredField(objectValue, "changeId", endpoint, path, parseNumber);
  const entityId = parseRequiredField(objectValue, "entityId", endpoint, path, parseString);

  if (entityType === "card") {
    return {
      changeId,
      entityType,
      entityId,
      action,
      payload: parseRequiredField(objectValue, "payload", endpoint, path, parseCard),
    };
  }

  if (entityType === "deck") {
    return {
      changeId,
      entityType,
      entityId,
      action,
      payload: parseRequiredField(objectValue, "payload", endpoint, path, parseDeck),
    };
  }

  return {
    changeId,
    entityType,
    entityId,
    action,
    payload: parseRequiredField(objectValue, "payload", endpoint, path, parseWorkspaceSchedulerSettings),
  };
}

function parseAgentApiKeyConnection(value: unknown, endpoint: string, path: string): AgentApiKeyConnection {
  const objectValue = parseObject(value, endpoint, path);
  return {
    connectionId: parseRequiredField(objectValue, "connectionId", endpoint, path, parseString),
    label: parseRequiredField(objectValue, "label", endpoint, path, parseString),
    createdAt: parseRequiredField(objectValue, "createdAt", endpoint, path, parseString),
    lastUsedAt: parseRequiredField(objectValue, "lastUsedAt", endpoint, path, parseNullableString),
    revokedAt: parseRequiredField(objectValue, "revokedAt", endpoint, path, parseNullableString),
  };
}

function parseChatConfig(value: unknown, endpoint: string, path: string): ChatConfig {
  const objectValue = parseObject(value, endpoint, path);
  const providerValue = parseRequiredField(objectValue, "provider", endpoint, path, parseObject);
  const modelValue = parseRequiredField(objectValue, "model", endpoint, path, parseObject);
  const reasoningValue = parseRequiredField(objectValue, "reasoning", endpoint, path, parseObject);
  const featuresValue = parseRequiredField(objectValue, "features", endpoint, path, parseObject);

  return {
    provider: {
      id: parseLiteral(
        parseRequiredField(providerValue, "id", endpoint, joinPath(path, "provider"), parseString),
        endpoint,
        joinPath(joinPath(path, "provider"), "id"),
        "openai",
      ),
      label: parseRequiredField(providerValue, "label", endpoint, joinPath(path, "provider"), parseString),
    },
    model: {
      id: parseRequiredField(modelValue, "id", endpoint, joinPath(path, "model"), parseString),
      label: parseRequiredField(modelValue, "label", endpoint, joinPath(path, "model"), parseString),
      badgeLabel: parseRequiredField(modelValue, "badgeLabel", endpoint, joinPath(path, "model"), parseString),
    },
    reasoning: {
      effort: parseRequiredField(reasoningValue, "effort", endpoint, joinPath(path, "reasoning"), parseReasoningEffort),
      label: parseRequiredField(reasoningValue, "label", endpoint, joinPath(path, "reasoning"), parseString),
    },
    features: {
      modelPickerEnabled: parseRequiredField(featuresValue, "modelPickerEnabled", endpoint, joinPath(path, "features"), parseBoolean),
      dictationEnabled: parseRequiredField(featuresValue, "dictationEnabled", endpoint, joinPath(path, "features"), parseBoolean),
      attachmentsEnabled: parseRequiredField(featuresValue, "attachmentsEnabled", endpoint, joinPath(path, "features"), parseBoolean),
    },
  };
}

function parseChatStreamPosition(value: unknown, endpoint: string, path: string): Readonly<{
  itemId: string;
  responseIndex?: number;
  outputIndex: number;
  contentIndex: number | null;
  sequenceNumber: number | null;
}> {
  const objectValue = parseObject(value, endpoint, path);
  const responseIndex = parseOptionalField(objectValue, "responseIndex", endpoint, path, parseNumber);

  return {
    itemId: parseRequiredField(objectValue, "itemId", endpoint, path, parseString),
    responseIndex,
    outputIndex: parseRequiredField(objectValue, "outputIndex", endpoint, path, parseNumber),
    contentIndex: parseRequiredField(objectValue, "contentIndex", endpoint, path, parseNullableNumber),
    sequenceNumber: parseRequiredField(objectValue, "sequenceNumber", endpoint, path, parseNullableNumber),
  };
}

function parseContentPart(value: unknown, endpoint: string, path: string): ContentPart {
  const objectValue = parseObject(value, endpoint, path);
  const type = parseRequiredField(objectValue, "type", endpoint, path, parseContentPartType);

  if (type === "text") {
    return {
      type,
      text: parseRequiredField(objectValue, "text", endpoint, path, parseString),
    };
  }

  if (type === "image") {
    return {
      type,
      mediaType: parseRequiredField(objectValue, "mediaType", endpoint, path, parseString),
      base64Data: parseRequiredField(objectValue, "base64Data", endpoint, path, parseString),
    };
  }

  if (type === "file") {
    return {
      type,
      mediaType: parseRequiredField(objectValue, "mediaType", endpoint, path, parseString),
      base64Data: parseRequiredField(objectValue, "base64Data", endpoint, path, parseString),
      fileName: parseRequiredField(objectValue, "fileName", endpoint, path, parseString),
    };
  }

  if (type === "tool_call") {
    return {
      type,
      id: parseOptionalField(objectValue, "id", endpoint, path, parseString),
      name: parseRequiredField(objectValue, "name", endpoint, path, parseString),
      status: parseRequiredField(objectValue, "status", endpoint, path, parseToolCallStatus),
      providerStatus: parseOptionalField(objectValue, "providerStatus", endpoint, path, parseNullableString),
      input: parseRequiredField(objectValue, "input", endpoint, path, parseNullableString),
      output: parseRequiredField(objectValue, "output", endpoint, path, parseNullableString),
      streamPosition: parseOptionalField(objectValue, "streamPosition", endpoint, path, parseChatStreamPosition),
    };
  }

  return {
    type,
    summary: parseRequiredField(objectValue, "summary", endpoint, path, parseString),
    streamPosition: parseOptionalField(objectValue, "streamPosition", endpoint, path, parseChatStreamPosition),
  };
}

function parseChatSessionHistoryMessage(
  value: unknown,
  endpoint: string,
  path: string,
): ChatSessionHistoryMessage {
  const objectValue = parseObject(value, endpoint, path);
  return {
    role: parseRequiredField(objectValue, "role", endpoint, path, parseChatRole),
    content: parseRequiredField(objectValue, "content", endpoint, path, parseContentPartArray),
    timestamp: parseRequiredField(objectValue, "timestamp", endpoint, path, parseNumber),
    isError: parseRequiredField(objectValue, "isError", endpoint, path, parseBoolean),
    isStopped: parseRequiredField(objectValue, "isStopped", endpoint, path, parseBoolean),
  };
}

function parseContentPartArray(value: unknown, endpoint: string, path: string): ReadonlyArray<ContentPart> {
  return parseArray(value, endpoint, path, parseContentPart);
}

function parseEffortLevel(value: unknown, endpoint: string, path: string): "fast" | "medium" | "long" {
  return parseEnum(value, endpoint, path, ["fast", "medium", "long"]);
}

function parseEffortLevels(value: unknown, endpoint: string, path: string): ReadonlyArray<"fast" | "medium" | "long"> {
  return parseArray(value, endpoint, path, parseEffortLevel);
}

function parseFsrsCardState(value: unknown, endpoint: string, path: string): "new" | "learning" | "review" | "relearning" {
  return parseEnum(value, endpoint, path, ["new", "learning", "review", "relearning"]);
}

function parseReviewRating(value: unknown, endpoint: string, path: string): 0 | 1 | 2 | 3 {
  return parseEnum(value, endpoint, path, [0, 1, 2, 3]);
}

function parseSyncBootstrapEntityType(
  value: unknown,
  endpoint: string,
  path: string,
): "card" | "deck" | "workspace_scheduler_settings" {
  return parseEnum(value, endpoint, path, ["card", "deck", "workspace_scheduler_settings"]);
}

function parseChatRole(value: unknown, endpoint: string, path: string): "user" | "assistant" {
  return parseEnum(value, endpoint, path, ["user", "assistant"]);
}

function parseReasoningEffort(value: unknown, endpoint: string, path: string): "low" | "medium" | "high" | "minimal" {
  return parseEnum(value, endpoint, path, ["low", "medium", "high", "minimal"]);
}

function parseContentPartType(
  value: unknown,
  endpoint: string,
  path: string,
): "text" | "image" | "file" | "tool_call" | "reasoning_summary" {
  return parseEnum(value, endpoint, path, ["text", "image", "file", "tool_call", "reasoning_summary"]);
}

function parseToolCallStatus(value: unknown, endpoint: string, path: string): "started" | "completed" {
  return parseEnum(value, endpoint, path, ["started", "completed"]);
}

function parseChatRunState(value: unknown, endpoint: string, path: string): "idle" | "running" | "interrupted" {
  return parseEnum(value, endpoint, path, ["idle", "running", "interrupted"]);
}

export function parseSessionInfoResponse(value: unknown, endpoint: string): SessionInfo {
  const objectValue = parseObject(value, endpoint, "");
  const profileValue = parseRequiredField(objectValue, "profile", endpoint, "", parseObject);

  return {
    userId: parseRequiredField(objectValue, "userId", endpoint, "", parseString),
    selectedWorkspaceId: parseRequiredField(objectValue, "selectedWorkspaceId", endpoint, "", parseNullableString),
    authTransport: parseRequiredField(objectValue, "authTransport", endpoint, "", parseString),
    csrfToken: parseRequiredField(objectValue, "csrfToken", endpoint, "", parseNullableString),
    profile: {
      email: parseRequiredField(profileValue, "email", endpoint, "profile", parseNullableString),
      locale: parseRequiredField(profileValue, "locale", endpoint, "profile", parseString),
      createdAt: parseRequiredField(profileValue, "createdAt", endpoint, "profile", parseString),
    },
  };
}

export function parseWorkspaceEnvelopeResponse(value: unknown, endpoint: string): WorkspaceEnvelope {
  const objectValue = parseObject(value, endpoint, "");
  return {
    workspace: parseRequiredField(objectValue, "workspace", endpoint, "", parseWorkspaceSummary),
  };
}

export function parseWorkspacesEnvelopeResponse(value: unknown, endpoint: string): WorkspacesEnvelope {
  const objectValue = parseObject(value, endpoint, "");
  return {
    workspaces: parseRequiredField(objectValue, "workspaces", endpoint, "", parseWorkspaceSummaryArray),
    nextCursor: parseRequiredField(objectValue, "nextCursor", endpoint, "", parseNullableString),
  };
}

function parseWorkspaceSummaryArray(value: unknown, endpoint: string, path: string): ReadonlyArray<WorkspaceSummary> {
  return parseArray(value, endpoint, path, parseWorkspaceSummary);
}

export function parseWorkspaceDeletePreviewResponse(value: unknown, endpoint: string): WorkspaceDeletePreview {
  const objectValue = parseObject(value, endpoint, "");
  return {
    workspaceId: parseRequiredField(objectValue, "workspaceId", endpoint, "", parseString),
    workspaceName: parseRequiredField(objectValue, "workspaceName", endpoint, "", parseString),
    activeCardCount: parseRequiredField(objectValue, "activeCardCount", endpoint, "", parseNumber),
    confirmationText: parseRequiredField(objectValue, "confirmationText", endpoint, "", parseString),
    isLastAccessibleWorkspace: parseRequiredField(objectValue, "isLastAccessibleWorkspace", endpoint, "", parseBoolean),
  };
}

export function parseDeleteWorkspaceResponse(value: unknown, endpoint: string): DeleteWorkspaceResponse {
  const objectValue = parseObject(value, endpoint, "");
  return {
    ok: parseLiteral(parseRequiredField(objectValue, "ok", endpoint, "", parseBoolean), endpoint, "ok", true),
    deletedWorkspaceId: parseRequiredField(objectValue, "deletedWorkspaceId", endpoint, "", parseString),
    deletedCardsCount: parseRequiredField(objectValue, "deletedCardsCount", endpoint, "", parseNumber),
    workspace: parseRequiredField(objectValue, "workspace", endpoint, "", parseWorkspaceSummary),
  };
}

export function parseAgentApiKeyConnectionsEnvelopeResponse(
  value: unknown,
  endpoint: string,
): AgentApiKeyConnectionsEnvelope {
  const objectValue = parseObject(value, endpoint, "");
  return {
    connections: parseRequiredField(objectValue, "connections", endpoint, "", parseAgentApiKeyConnectionArray),
    instructions: parseRequiredField(objectValue, "instructions", endpoint, "", parseString),
    nextCursor: parseRequiredField(objectValue, "nextCursor", endpoint, "", parseNullableString),
  };
}

function parseAgentApiKeyConnectionArray(
  value: unknown,
  endpoint: string,
  path: string,
): ReadonlyArray<AgentApiKeyConnection> {
  return parseArray(value, endpoint, path, parseAgentApiKeyConnection);
}

export function parseAgentApiKeyRevokeResponse(value: unknown, endpoint: string): Readonly<{
  ok: true;
  connection: AgentApiKeyConnection;
  instructions: string;
}> {
  const objectValue = parseObject(value, endpoint, "");
  return {
    ok: parseLiteral(parseRequiredField(objectValue, "ok", endpoint, "", parseBoolean), endpoint, "ok", true),
    connection: parseRequiredField(objectValue, "connection", endpoint, "", parseAgentApiKeyConnection),
    instructions: parseRequiredField(objectValue, "instructions", endpoint, "", parseString),
  };
}

export function parseDeleteAccountResponse(value: unknown, endpoint: string): Readonly<{ ok: true }> {
  const objectValue = parseObject(value, endpoint, "");
  return {
    ok: parseLiteral(parseRequiredField(objectValue, "ok", endpoint, "", parseBoolean), endpoint, "ok", true),
  };
}

export function parseSyncPushResultResponse(value: unknown, endpoint: string): SyncPushResult {
  const objectValue = parseObject(value, endpoint, "");
  return {
    operations: parseRequiredField(objectValue, "operations", endpoint, "", parseSyncPushOperationResults),
  };
}

function parseSyncPushOperationResults(
  value: unknown,
  endpoint: string,
  path: string,
): ReadonlyArray<Readonly<{
  operationId: string;
  entityType: "card" | "deck" | "workspace_scheduler_settings" | "review_event";
  entityId: string;
  status: "applied" | "ignored" | "duplicate" | "rejected";
  resultingHotChangeId: number | null;
  error: string | null;
}>> {
  return parseArray(value, endpoint, path, parseSyncPushOperationResult);
}

function parseSyncPushOperationResult(
  value: unknown,
  endpoint: string,
  path: string,
): Readonly<{
  operationId: string;
  entityType: "card" | "deck" | "workspace_scheduler_settings" | "review_event";
  entityId: string;
  status: "applied" | "ignored" | "duplicate" | "rejected";
  resultingHotChangeId: number | null;
  error: string | null;
}> {
  const objectValue = parseObject(value, endpoint, path);
  return {
    operationId: parseRequiredField(objectValue, "operationId", endpoint, path, parseString),
    entityType: parseRequiredField(objectValue, "entityType", endpoint, path, parseSyncPushResultEntityType),
    entityId: parseRequiredField(objectValue, "entityId", endpoint, path, parseString),
    status: parseRequiredField(objectValue, "status", endpoint, path, parseSyncPushStatus),
    resultingHotChangeId: parseRequiredField(objectValue, "resultingHotChangeId", endpoint, path, parseNullableNumber),
    error: parseRequiredField(objectValue, "error", endpoint, path, parseNullableString),
  };
}

function parseSyncPushResultEntityType(
  value: unknown,
  endpoint: string,
  path: string,
): "card" | "deck" | "workspace_scheduler_settings" | "review_event" {
  return parseEnum(value, endpoint, path, ["card", "deck", "workspace_scheduler_settings", "review_event"]);
}

function parseSyncPushStatus(
  value: unknown,
  endpoint: string,
  path: string,
): "applied" | "ignored" | "duplicate" | "rejected" {
  return parseEnum(value, endpoint, path, ["applied", "ignored", "duplicate", "rejected"]);
}

export function parseSyncPullResultResponse(value: unknown, endpoint: string): SyncPullResult {
  const objectValue = parseObject(value, endpoint, "");
  return {
    changes: parseRequiredField(objectValue, "changes", endpoint, "", parseSyncChangeArray),
    nextHotChangeId: parseRequiredField(objectValue, "nextHotChangeId", endpoint, "", parseNumber),
    hasMore: parseRequiredField(objectValue, "hasMore", endpoint, "", parseBoolean),
  };
}

function parseSyncChangeArray(value: unknown, endpoint: string, path: string): ReadonlyArray<SyncChange> {
  return parseArray(value, endpoint, path, parseSyncChange);
}

export function parseSyncBootstrapPullResultResponse(
  value: unknown,
  endpoint: string,
): SyncBootstrapPullResult {
  const objectValue = parseObject(value, endpoint, "");
  return {
    mode: parseLiteral(parseRequiredField(objectValue, "mode", endpoint, "", parseString), endpoint, "mode", "pull"),
    entries: parseRequiredField(objectValue, "entries", endpoint, "", parseSyncBootstrapEntryArray),
    nextCursor: parseRequiredField(objectValue, "nextCursor", endpoint, "", parseNullableString),
    hasMore: parseRequiredField(objectValue, "hasMore", endpoint, "", parseBoolean),
    bootstrapHotChangeId: parseRequiredField(objectValue, "bootstrapHotChangeId", endpoint, "", parseNumber),
    remoteIsEmpty: parseRequiredField(objectValue, "remoteIsEmpty", endpoint, "", parseBoolean),
  };
}

function parseSyncBootstrapEntryArray(
  value: unknown,
  endpoint: string,
  path: string,
): ReadonlyArray<SyncBootstrapEntry> {
  return parseArray(value, endpoint, path, parseSyncBootstrapEntry);
}

export function parseSyncBootstrapPushResultResponse(
  value: unknown,
  endpoint: string,
): SyncBootstrapPushResult {
  const objectValue = parseObject(value, endpoint, "");
  return {
    mode: parseLiteral(parseRequiredField(objectValue, "mode", endpoint, "", parseString), endpoint, "mode", "push"),
    appliedEntriesCount: parseRequiredField(objectValue, "appliedEntriesCount", endpoint, "", parseNumber),
    bootstrapHotChangeId: parseRequiredField(objectValue, "bootstrapHotChangeId", endpoint, "", parseNumber),
  };
}

export function parseSyncReviewHistoryPullResultResponse(
  value: unknown,
  endpoint: string,
): SyncReviewHistoryPullResult {
  const objectValue = parseObject(value, endpoint, "");
  return {
    reviewEvents: parseRequiredField(objectValue, "reviewEvents", endpoint, "", parseReviewEventArray),
    nextReviewSequenceId: parseRequiredField(objectValue, "nextReviewSequenceId", endpoint, "", parseNumber),
    hasMore: parseRequiredField(objectValue, "hasMore", endpoint, "", parseBoolean),
  };
}

function parseReviewEventArray(value: unknown, endpoint: string, path: string): ReadonlyArray<ReviewEvent> {
  return parseArray(value, endpoint, path, parseReviewEvent);
}

export function parseSyncReviewHistoryImportResultResponse(
  value: unknown,
  endpoint: string,
): SyncReviewHistoryImportResult {
  const objectValue = parseObject(value, endpoint, "");
  return {
    importedCount: parseRequiredField(objectValue, "importedCount", endpoint, "", parseNumber),
    duplicateCount: parseRequiredField(objectValue, "duplicateCount", endpoint, "", parseNumber),
    nextReviewSequenceId: parseRequiredField(objectValue, "nextReviewSequenceId", endpoint, "", parseNumber),
  };
}

export function parseQueryCardsPageResponse(value: unknown, endpoint: string): QueryCardsPage {
  const objectValue = parseObject(value, endpoint, "");
  return {
    cards: parseRequiredField(objectValue, "cards", endpoint, "", parseCardArray),
    nextCursor: parseRequiredField(objectValue, "nextCursor", endpoint, "", parseNullableString),
    totalCount: parseRequiredField(objectValue, "totalCount", endpoint, "", parseNumber),
  };
}

function parseCardArray(value: unknown, endpoint: string, path: string): ReadonlyArray<Card> {
  return parseArray(value, endpoint, path, parseCard);
}

export function parseChatSessionSnapshotResponse(value: unknown, endpoint: string): ChatSessionSnapshot {
  const objectValue = parseObject(value, endpoint, "");
  return {
    sessionId: parseRequiredField(objectValue, "sessionId", endpoint, "", parseString),
    runState: parseRequiredField(objectValue, "runState", endpoint, "", parseChatRunState),
    updatedAt: parseRequiredField(objectValue, "updatedAt", endpoint, "", parseNumber),
    mainContentInvalidationVersion: parseRequiredField(objectValue, "mainContentInvalidationVersion", endpoint, "", parseNumber),
    chatConfig: parseRequiredField(objectValue, "chatConfig", endpoint, "", parseChatConfig),
    messages: parseRequiredField(objectValue, "messages", endpoint, "", parseChatSessionHistoryMessageArray),
  };
}

function parseChatSessionHistoryMessageArray(
  value: unknown,
  endpoint: string,
  path: string,
): ReadonlyArray<ChatSessionHistoryMessage> {
  return parseArray(value, endpoint, path, parseChatSessionHistoryMessage);
}

export function parseStartChatRunResponse(value: unknown, endpoint: string): StartChatRunResponse {
  const objectValue = parseObject(value, endpoint, "");
  return {
    ok: parseLiteral(parseRequiredField(objectValue, "ok", endpoint, "", parseBoolean), endpoint, "ok", true),
    sessionId: parseRequiredField(objectValue, "sessionId", endpoint, "", parseString),
    runId: parseRequiredField(objectValue, "runId", endpoint, "", parseString),
    runState: parseLiteral(parseRequiredField(objectValue, "runState", endpoint, "", parseString), endpoint, "runState", "running"),
    chatConfig: parseRequiredField(objectValue, "chatConfig", endpoint, "", parseChatConfig),
  };
}

export function parseResetChatSessionResponse(value: unknown, endpoint: string): ResetChatSessionResponse {
  const objectValue = parseObject(value, endpoint, "");
  return {
    ok: parseLiteral(parseRequiredField(objectValue, "ok", endpoint, "", parseBoolean), endpoint, "ok", true),
    sessionId: parseRequiredField(objectValue, "sessionId", endpoint, "", parseString),
    chatConfig: parseRequiredField(objectValue, "chatConfig", endpoint, "", parseChatConfig),
  };
}

export function parseStopChatRunResponse(value: unknown, endpoint: string): StopChatRunResponse {
  const objectValue = parseObject(value, endpoint, "");
  return {
    ok: parseLiteral(parseRequiredField(objectValue, "ok", endpoint, "", parseBoolean), endpoint, "ok", true),
    sessionId: parseRequiredField(objectValue, "sessionId", endpoint, "", parseString),
    runId: parseRequiredField(objectValue, "runId", endpoint, "", parseNullableString),
    stopped: parseRequiredField(objectValue, "stopped", endpoint, "", parseBoolean),
    stillRunning: parseRequiredField(objectValue, "stillRunning", endpoint, "", parseBoolean),
  };
}

export function parseChatTranscriptionResponse(value: unknown, endpoint: string): ChatTranscriptionResponse {
  const objectValue = parseObject(value, endpoint, "");
  return {
    text: parseRequiredField(objectValue, "text", endpoint, "", parseString),
    sessionId: parseRequiredField(objectValue, "sessionId", endpoint, "", parseString),
  };
}
