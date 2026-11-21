import type { DatabaseExecutor } from "../database";

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
