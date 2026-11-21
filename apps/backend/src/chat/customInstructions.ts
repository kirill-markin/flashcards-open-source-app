import {
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../database";
import { activeGuestSessionOwnerPredicateSql, guestSessionBoundToAccountSql } from "../guestAuth/shared";
import { HttpError } from "../shared/errors";
import { lockWorkspaceAccessLifecycleInExecutor, lockWorkspaceMembershipLifecyclesInExecutor } from "../workspaces/accessLocks";
import { loadWorkspaceManagementRowInExecutor } from "../workspaces/queries";
import { assertWorkspaceOwner } from "../workspaces/shared";

/** Counted in Unicode code points; the table's CHECK enforces the same limit. */
export const workspaceChatInstructionsMaxLength = 1500;

export type WorkspaceChatInstructionsResponse = Readonly<{
  customInstructions: string | null;
  maxLength: number;
  canEdit: boolean;
}>;

export type ChatGuestCredential = Readonly<{ sessionId: string | null }>;

export async function isEligibleChatGuestInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  credential: ChatGuestCredential,
): Promise<boolean> {
  if (credential.sessionId === null) return false;

  // Binding, merge and deletion take the exclusive account lock before changing identity.
  // Forget can independently revoke the exact session, so hold its row through the scoped operation.
  await executor.query(
    "SELECT pg_advisory_xact_lock_shared(hashtextextended('auth.account:' || $1, 2::BIGINT))",
    [userId],
  );
  const result = await executor.query(
    `SELECT 1 FROM auth.guest_sessions
     WHERE ${activeGuestSessionOwnerPredicateSql}
       AND user_id = $2
       AND NOT ${guestSessionBoundToAccountSql}
       AND (purpose = 'browser_product' AND platform = 'web'
         OR purpose = 'legacy' AND platform IS DISTINCT FROM 'web')
     FOR SHARE`,
    [credential.sessionId, userId],
  );
  return result.rowCount === 1;
}

function createChatGuestCredentialError(): HttpError {
  return new HttpError(403, "Use an active guest session or sign in to access workspace AI instructions.",
    "ACCOUNT_SIGN_IN_REQUIRED");
}

async function assertChatInstructionsCredentialInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  guestCredential: ChatGuestCredential | undefined,
): Promise<void> {
  if (guestCredential !== undefined && !await isEligibleChatGuestInExecutor(executor, userId, guestCredential)) {
    throw createChatGuestCredentialError();
  }
}

export async function assertGuestChatInstructionsStillAuthorized(
  scope: WorkspaceDatabaseScope,
  guestSessionId: string,
): Promise<void> {
  await transactionWithWorkspaceScope(scope, async (executor) => {
    await assertChatInstructionsCredentialInExecutor(executor, scope.userId, { sessionId: guestSessionId });
    const result = await executor.query<Readonly<{ allowed: boolean }>>(
      "SELECT security.current_workspace_access_allowed($1) AS allowed",
      [scope.workspaceId],
    );
    if (result.rows[0]?.allowed !== true) throw createChatGuestCredentialError();
  });
}

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

function toResponse(customInstructions: string | null, canEdit: boolean): WorkspaceChatInstructionsResponse {
  return { customInstructions, maxLength: workspaceChatInstructionsMaxLength, canEdit };
}

export async function loadWorkspaceChatInstructionsForUser(
  userId: string,
  workspaceId: string,
  guestCredential?: ChatGuestCredential,
): Promise<WorkspaceChatInstructionsResponse> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await assertChatInstructionsCredentialInExecutor(executor, userId, guestCredential);
    const workspace = await loadWorkspaceManagementRowInExecutor(executor, userId, workspaceId);
    return toResponse(await loadWorkspaceChatInstructionsWithExecutor(executor, workspaceId), workspace.role === "owner");
  });
}

export async function saveWorkspaceChatInstructionsForUser(
  userId: string,
  workspaceId: string,
  customInstructions: string | null,
  guestCredential?: ChatGuestCredential,
): Promise<WorkspaceChatInstructionsResponse> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await assertChatInstructionsCredentialInExecutor(executor, userId, guestCredential);
    await lockWorkspaceMembershipLifecyclesInExecutor(executor, [workspaceId]);
    await lockWorkspaceAccessLifecycleInExecutor(executor, userId, workspaceId);
    const managedWorkspace = await loadWorkspaceManagementRowInExecutor(executor, userId, workspaceId);
    assertWorkspaceOwner(managedWorkspace.role);
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

    return toResponse(customInstructions, true);
  });
}
