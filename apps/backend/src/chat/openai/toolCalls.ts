/**
 * Tool-call state machine for the backend-owned OpenAI loop.
 * These helpers merge provider deltas into stable tool-call events that can be persisted and replayed.
 */
import type { ChatStreamEvent } from "../types";

export const INTERRUPTED_TOOL_CALL_OUTPUT = "Interrupted before output was captured.";

export type FunctionToolCallRawItem = Readonly<{
  type: "function_call";
  callId: string;
  id?: string;
  name: string;
  arguments?: string;
  status?: string;
}>;

export type ToolCallOutputRawItem = Readonly<{
  type: string;
  callId?: string;
  id?: string;
  name?: string;
}>;

export type ToolCallPosition = Readonly<{
  itemId: string;
  responseIndex: number;
  outputIndex: number;
  sequenceNumber: number | null;
}>;

export type FunctionCallArgumentsDeltaEvent = Readonly<{
  itemId: string;
  outputIndex: number;
  sequenceNumber: number;
  delta: string;
}>;

export type FunctionCallArgumentsDoneEvent = Readonly<{
  itemId: string;
  outputIndex: number;
  sequenceNumber: number;
  arguments: string;
}>;

export type ToolCallEvent = Extract<ChatStreamEvent, { type: "tool_call" }>;

type ToolCallState = Readonly<{
  snapshot: ToolCallEvent;
  startedAt: number;
}>;

export type ToolCallStateMap = ReadonlyMap<string, ToolCallState>;

type ToolCallUpdate = Readonly<{
  toolStates: ToolCallStateMap;
  event: ToolCallEvent | null;
  started: boolean;
  completed: boolean;
  durationMs: number | null;
}>;

const TERMINAL_TOOL_PROVIDER_STATUSES = new Set(["completed", "failed", "incomplete"]);

function stringifyToolValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function isTerminalToolProviderStatus(status: string | null | undefined): boolean {
  return status !== undefined && status !== null && TERMINAL_TOOL_PROVIDER_STATUSES.has(status);
}

function createToolCallEvent(
  id: string,
  itemId: string,
  name: string,
  status: ToolCallEvent["status"],
  responseIndex: number,
  outputIndex: number,
  sequenceNumber: number | null,
  providerStatus: string | null,
  input: string | null,
  output: string | null,
  refreshRoute: boolean,
): ToolCallEvent {
  return {
    type: "tool_call",
    id,
    itemId,
    name,
    status,
    responseIndex,
    outputIndex,
    sequenceNumber,
    ...(providerStatus !== null ? { providerStatus } : {}),
    ...(input !== null ? { input } : {}),
    ...(output !== null ? { output } : {}),
    ...(refreshRoute ? { refreshRoute: true } : {}),
  };
}

/**
 * Returns the stable tool-call identifier required to merge provider updates across events.
 */
export function getRequiredToolCallId(rawItem: FunctionToolCallRawItem | ToolCallOutputRawItem): string {
  if ("callId" in rawItem && typeof rawItem.callId === "string" && rawItem.callId.length > 0) {
    return rawItem.callId;
  }

  if (typeof rawItem.id === "string" && rawItem.id.length > 0) {
    return rawItem.id;
  }

  throw new Error(`OpenAI tool call is missing a stable identifier: ${JSON.stringify(rawItem)}`);
}

function getRequiredToolItemId(
  rawItem: FunctionToolCallRawItem | ToolCallOutputRawItem,
  previousSnapshot: ToolCallEvent | null,
): string {
  if (typeof rawItem.id === "string" && rawItem.id.length > 0) {
    return rawItem.id;
  }

  if (previousSnapshot !== null) {
    return previousSnapshot.itemId;
  }

  throw new Error(`OpenAI tool call is missing an output item id: ${JSON.stringify(rawItem)}`);
}

function getRequiredToolOutputIndex(
  previousSnapshot: ToolCallEvent | null,
  rawItem: ToolCallOutputRawItem,
): number {
  if (previousSnapshot !== null) {
    return previousSnapshot.outputIndex;
  }

  throw new Error(`OpenAI tool call output arrived before a tracked output item existed: ${JSON.stringify(rawItem)}`);
}

function buildFunctionToolCallEvent(
  rawItem: FunctionToolCallRawItem,
  position: ToolCallPosition,
): ToolCallEvent {
  const providerStatus = typeof rawItem.status === "string" ? rawItem.status : null;

  return createToolCallEvent(
    getRequiredToolCallId(rawItem),
    position.itemId,
    rawItem.name,
    isTerminalToolProviderStatus(providerStatus) ? "completed" : "started",
    position.responseIndex,
    position.outputIndex,
    position.sequenceNumber,
    providerStatus,
    rawItem.arguments ?? null,
    null,
    false,
  );
}

function buildToolOutputEvent(
  rawItem: ToolCallOutputRawItem,
  previousSnapshot: ToolCallEvent | null,
  rawOutput: unknown,
  refreshRoute: boolean,
): ToolCallEvent {
  const id = getRequiredToolCallId(rawItem);
  const output = stringifyToolValue(rawOutput);
  const name = previousSnapshot?.name ?? (typeof rawItem.name === "string" ? rawItem.name : "tool");

  return createToolCallEvent(
    id,
    getRequiredToolItemId(rawItem, previousSnapshot),
    name,
    "completed",
    previousSnapshot?.responseIndex ?? 0,
    getRequiredToolOutputIndex(previousSnapshot, rawItem),
    previousSnapshot?.sequenceNumber ?? null,
    "completed",
    previousSnapshot?.input ?? null,
    output,
    refreshRoute,
  );
}

function areToolCallEventsEqual(left: ToolCallEvent, right: ToolCallEvent): boolean {
  return left.id === right.id
    && left.itemId === right.itemId
    && left.name === right.name
    && left.status === right.status
    && left.responseIndex === right.responseIndex
    && left.outputIndex === right.outputIndex
    && left.sequenceNumber === right.sequenceNumber
    && left.providerStatus === right.providerStatus
    && left.input === right.input
    && left.output === right.output
    && left.refreshRoute === right.refreshRoute;
}

function setToolCallState(
  toolStates: ToolCallStateMap,
  event: ToolCallEvent,
  startedAt: number,
): ToolCallStateMap {
  const nextToolStates = new Map(toolStates);
  nextToolStates.set(event.id, { snapshot: event, startedAt });
  return nextToolStates;
}

function findToolStateByItemId(toolStates: ToolCallStateMap, itemId: string): ToolCallState | null {
  for (const state of toolStates.values()) {
    if (state.snapshot.itemId === itemId) {
      return state;
    }
  }

  return null;
}

/**
 * Merges a new provider snapshot onto the last known tool-call snapshot without losing earlier metadata.
 */
function mergeToolCallSnapshot(previousSnapshot: ToolCallEvent, nextSnapshot: ToolCallEvent): ToolCallEvent {
  return createToolCallEvent(
    nextSnapshot.id,
    previousSnapshot.itemId,
    nextSnapshot.name,
    nextSnapshot.status,
    nextSnapshot.responseIndex ?? previousSnapshot.responseIndex ?? 0,
    previousSnapshot.outputIndex,
    nextSnapshot.sequenceNumber ?? previousSnapshot.sequenceNumber,
    nextSnapshot.providerStatus ?? previousSnapshot.providerStatus ?? null,
    nextSnapshot.input ?? previousSnapshot.input ?? null,
    nextSnapshot.output ?? previousSnapshot.output ?? null,
    nextSnapshot.refreshRoute === true || previousSnapshot.refreshRoute === true,
  );
}

/**
 * Creates the empty tool-call state map used by each OpenAI loop invocation.
 */
export function createToolCallStateMap(): ToolCallStateMap {
  return new Map();
}

/**
 * Applies a provider function-call start/update event to the tracked tool-call state.
 */
export function applyToolCallStarted(
  toolStates: ToolCallStateMap,
  rawItem: FunctionToolCallRawItem,
  position: ToolCallPosition,
  nowMs: number,
): ToolCallUpdate {
  const rawSnapshot = buildFunctionToolCallEvent(rawItem, position);
  const previousState = toolStates.get(rawSnapshot.id);
  const nextSnapshot = previousState === undefined
    ? rawSnapshot
    : mergeToolCallSnapshot(previousState.snapshot, rawSnapshot);
  const nextToolStates = setToolCallState(
    toolStates,
    nextSnapshot,
    previousState?.startedAt ?? nowMs,
  );

  return {
    toolStates: nextToolStates,
    event: previousState !== undefined && areToolCallEventsEqual(previousState.snapshot, nextSnapshot)
      ? null
      : nextSnapshot,
    started: previousState === undefined,
    completed: nextSnapshot.status === "completed",
    durationMs: previousState === undefined ? null : nowMs - previousState.startedAt,
  };
}

/**
 * Appends streamed function-call argument deltas to the tracked tool-call snapshot.
 */
export function applyFunctionCallArgumentsDelta(
  toolStates: ToolCallStateMap,
  deltaEvent: FunctionCallArgumentsDeltaEvent,
): ToolCallUpdate {
  const previousState = findToolStateByItemId(toolStates, deltaEvent.itemId);
  if (previousState === null) {
    return {
      toolStates,
      event: null,
      started: false,
      completed: false,
      durationMs: null,
    };
  }

  const nextSnapshot = mergeToolCallSnapshot(previousState.snapshot, {
    ...previousState.snapshot,
    input: `${previousState.snapshot.input ?? ""}${deltaEvent.delta}`,
    sequenceNumber: deltaEvent.sequenceNumber,
  });
  const nextToolStates = setToolCallState(toolStates, nextSnapshot, previousState.startedAt);

  return {
    toolStates: nextToolStates,
    event: areToolCallEventsEqual(previousState.snapshot, nextSnapshot) ? null : nextSnapshot,
    started: false,
    completed: nextSnapshot.status === "completed",
    durationMs: null,
  };
}

/**
 * Applies the final function-call arguments payload emitted by the provider.
 */
export function applyFunctionCallArgumentsDone(
  toolStates: ToolCallStateMap,
  doneEvent: FunctionCallArgumentsDoneEvent,
): ToolCallUpdate {
  const previousState = findToolStateByItemId(toolStates, doneEvent.itemId);
  if (previousState === null) {
    return {
      toolStates,
      event: null,
      started: false,
      completed: false,
      durationMs: null,
    };
  }

  const nextSnapshot = mergeToolCallSnapshot(previousState.snapshot, {
    ...previousState.snapshot,
    input: doneEvent.arguments,
    sequenceNumber: doneEvent.sequenceNumber,
  });
  const nextToolStates = setToolCallState(toolStates, nextSnapshot, previousState.startedAt);

  return {
    toolStates: nextToolStates,
    event: areToolCallEventsEqual(previousState.snapshot, nextSnapshot) ? null : nextSnapshot,
    started: false,
    completed: nextSnapshot.status === "completed",
    durationMs: null,
  };
}

/**
 * Applies a completed tool output event and marks the tracked tool call as finished.
 */
export function applyToolCallOutput(
  toolStates: ToolCallStateMap,
  rawItem: ToolCallOutputRawItem,
  output: unknown,
  nowMs: number,
  refreshRoute: boolean,
): ToolCallUpdate {
  const toolCallId = getRequiredToolCallId(rawItem);
  const previousState = toolStates.get(toolCallId) ?? findToolStateByItemId(
    toolStates,
    rawItem.id ?? "",
  );

  const nextSnapshot = buildToolOutputEvent(
    rawItem,
    previousState?.snapshot ?? null,
    output,
    refreshRoute,
  );
  const nextToolStates = setToolCallState(
    toolStates,
    nextSnapshot,
    previousState?.startedAt ?? nowMs,
  );

  return {
    toolStates: nextToolStates,
    event: previousState !== null && previousState !== undefined && areToolCallEventsEqual(previousState.snapshot, nextSnapshot)
      ? null
      : nextSnapshot,
    started: previousState === null || previousState === undefined,
    completed: true,
    durationMs: previousState === null || previousState === undefined ? null : nowMs - previousState.startedAt,
  };
}
