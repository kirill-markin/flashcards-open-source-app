/**
 * Public facade for backend-owned chat run execution.
 * Internal implementation is split across focused modules under `./runtime/`.
 */
export type {
  ChatRuntimeDependencies,
} from "./runtime/dependencies";
export {
  runPersistedChatSession,
  runPersistedChatSessionWithDeps,
} from "./runtime/executor";
export {
  ChatRunOwnershipLostError,
} from "./runtime/types";
export type {
  ChatWorkerRunResult,
  StartPersistedChatRunParams,
} from "./runtime/types";
