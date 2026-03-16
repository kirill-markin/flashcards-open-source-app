import { loadCloudSettings } from "../localDb/cloudSettings";
import { listOutboxRecords } from "../localDb/outbox";
import type { WorkspaceSummary } from "../types";
import {
  getPageStartIndex,
  makeOutboxPayload,
  normalizeLimit,
  parseEmptyObjectInput,
  parseListOutboxInput,
  parseSqlInput,
} from "./localToolExecutorInput";
import { executeSqlBatchLocally } from "./localToolExecutorSql";
import type {
  LocalToolCallRequest,
  LocalToolExecutionResult,
  WebLocalToolExecutorDependencies,
} from "./localToolExecutorTypes";

async function ensureLocalWorkspace(
  dependencies: WebLocalToolExecutorDependencies,
): Promise<WorkspaceSummary> {
  if (dependencies.session === null) {
    throw new Error("Session is unavailable");
  }

  if (dependencies.activeWorkspace === null) {
    throw new Error("Workspace is unavailable");
  }

  return dependencies.activeWorkspace;
}

export async function executeLocalToolCall(
  dependencies: WebLocalToolExecutorDependencies,
  toolCallRequest: LocalToolCallRequest,
): Promise<LocalToolExecutionResult> {
  const activeWorkspace = await ensureLocalWorkspace(dependencies);

  switch (toolCallRequest.name) {
  case "sql": {
    const input = parseSqlInput(toolCallRequest);
    const result = await executeSqlBatchLocally(dependencies, activeWorkspace, input.sql);
    return {
      output: JSON.stringify(result.payload),
      didMutateAppState: result.didMutateAppState,
    };
  }
  case "get_cloud_settings":
    parseEmptyObjectInput(toolCallRequest);
    {
      const cloudSettings = await loadCloudSettings();
      if (cloudSettings === null) {
        throw new Error("Cloud settings are not loaded");
      }

      return {
        output: JSON.stringify(cloudSettings),
        didMutateAppState: false,
      };
    }
  case "list_outbox": {
    const input = parseListOutboxInput(toolCallRequest);
    const outbox = await listOutboxRecords(activeWorkspace.workspaceId);
    return {
      output: JSON.stringify(
        makeOutboxPayload(
          outbox,
          activeWorkspace.workspaceId,
          getPageStartIndex(input.cursor),
          normalizeLimit(input.limit),
        ),
      ),
      didMutateAppState: false,
    };
  }
  default:
    throw new Error(`Unsupported AI tool: ${toolCallRequest.name}`);
  }
}
