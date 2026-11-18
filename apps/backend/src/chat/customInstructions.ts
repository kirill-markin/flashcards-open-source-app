import {
  applyWorkspaceDatabaseScopeInExecutor,
  transactionWithUserScope,
  type DatabaseExecutor,
} from "../database";
import { HttpError } from "../shared/errors";
import { loadWorkspaceManagementRowInExecutor } from "../workspaces/queries";
import { assertWorkspaceOwner } from "../workspaces/shared";

/** Counted in Unicode code points; the table's CHECK enforces the same limit. */
export const workspaceChatInstructionsMaxLength = 1500;

export type WorkspaceChatInstructionsResponse = Readonly<{
  customInstructions: string | null;
  maxLength: number;
}>;

const loneSurrogatePattern = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function parseChatCustomInstructionsBody(body: Record<string, unknown>): string | null {
  const value = body.customInstructions;
  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.includes("\u0000") || loneSurrogatePattern.test(value)) {
    throw new HttpError(
      400,
      "customInstructions must be a string of valid Unicode text without NUL characters, or null to clear.",
      "CHAT_CUSTOM_INSTRUCTIONS_INVALID",
    );
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  if ([...trimmed].length > workspaceChatInstructionsMaxLength) {
    throw new HttpError(
      400,
      `customInstructions must be at most ${workspaceChatInstructionsMaxLength} characters.`,
      "CHAT_CUSTOM_INSTRUCTIONS_TOO_LONG",
    );
  }

  return trimmed;
}

/** Reads under the caller's workspace scope; RLS admits every member. */
export async function loadWorkspaceChatInstructionsWithExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<string | null> {
  const result = await executor.query<Readonly<{ custom_instructions: string }>>(
    "SELECT custom_instructions FROM ai.workspace_chat_instructions WHERE workspace_id = $1",
    [workspaceId],
  );
  return result.rows[0]?.custom_instructions ?? null;
}

function toResponse(customInstructions: string | null): WorkspaceChatInstructionsResponse {
  return { customInstructions, maxLength: workspaceChatInstructionsMaxLength };
}

export async function loadWorkspaceChatInstructionsForUser(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceChatInstructionsResponse> {
  return transactionWithUserScope({ userId }, async (executor) => {
    await loadWorkspaceManagementRowInExecutor(executor, userId, workspaceId);
    await applyWorkspaceDatabaseScopeInExecutor(executor, { userId, workspaceId });
    return toResponse(await loadWorkspaceChatInstructionsWithExecutor(executor, workspaceId));
  });
}

export async function saveWorkspaceChatInstructionsForUser(
  userId: string,
  workspaceId: string,
  customInstructions: string | null,
): Promise<WorkspaceChatInstructionsResponse> {
  return transactionWithUserScope({ userId }, async (executor) => {
    const managedWorkspace = await loadWorkspaceManagementRowInExecutor(executor, userId, workspaceId);
    assertWorkspaceOwner(managedWorkspace.role);
    await applyWorkspaceDatabaseScopeInExecutor(executor, { userId, workspaceId });
    if (customInstructions === null) {
      await executor.query("DELETE FROM ai.workspace_chat_instructions WHERE workspace_id = $1", [workspaceId]);
    } else {
      await executor.query(
        [
          "INSERT INTO ai.workspace_chat_instructions (workspace_id, custom_instructions) VALUES ($1, $2)",
          "ON CONFLICT (workspace_id) DO UPDATE SET custom_instructions = EXCLUDED.custom_instructions, updated_at = now()",
        ].join(" "),
        [workspaceId, customInstructions],
      );
    }

    return toResponse(customInstructions);
  });
}

/**
 * Guest merge: copies the guest workspace's instructions into the destination when its user owns it.
 * The destination's own value wins. Expects the destination workspace scope to be applied.
 */
export async function copyWorkspaceChatInstructionsInExecutor(
  executor: DatabaseExecutor,
  customInstructions: string | null,
  targetWorkspaceId: string,
): Promise<void> {
  if (customInstructions === null) {
    return;
  }

  await executor.query(
    [
      "INSERT INTO ai.workspace_chat_instructions (workspace_id, custom_instructions)",
      "SELECT $1::uuid, $2::text WHERE security.current_user_is_workspace_owner($1::uuid)",
      "ON CONFLICT (workspace_id) DO NOTHING",
    ].join(" "),
    [targetWorkspaceId, customInstructions],
  );
}
