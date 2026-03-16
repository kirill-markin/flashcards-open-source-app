/**
 * Browser-local AI tool executor.
 *
 * Shared workspace access is intentionally collapsed to the single `sql` tool
 * so the browser-local runtime mirrors the public agent surface. Local-only
 * runtime utilities remain separate.
 *
 * The iOS mirror lives in
 * `apps/ios/Flashcards/Flashcards/AI/LocalAIToolExecutor.swift`.
 */
import { executeLocalToolCall } from "./localToolExecutorDispatch";
import type {
  LocalToolCallRequest,
  LocalToolExecutionResult,
  WebLocalToolExecutorDependencies,
} from "./localToolExecutorTypes";

export type {
  LocalToolCallRequest,
  LocalToolExecutionResult,
} from "./localToolExecutorTypes";

/**
 * Browser-local tool catalog. Keep this aligned with the mirrored iOS local
 * tool list in `apps/ios/Flashcards/Flashcards/AI/AIChatTypes.swift`.
 */
export const LOCAL_TOOL_NAMES = [
  "sql",
  "get_cloud_settings",
  "list_outbox",
] as const;

/**
 * Builds a browser-local AI tool executor that mirrors the backend SQL
 * surface while reading directly from IndexedDB query helpers.
 */
export function createLocalToolExecutor(
  dependencies: WebLocalToolExecutorDependencies,
): Readonly<{
  execute: (toolCallRequest: LocalToolCallRequest) => Promise<LocalToolExecutionResult>;
}> {
  return {
    async execute(toolCallRequest: LocalToolCallRequest): Promise<LocalToolExecutionResult> {
      return executeLocalToolCall(dependencies, toolCallRequest);
    },
  };
}
