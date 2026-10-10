import type { Context } from "hono";
import { z } from "zod";
import { executeChatSandboxSqlCall } from "../../chat/openai/tools/tools";
import { getChatRunClaimStateWithExecutor } from "../../chat/runs";
import { transactionWithWorkspaceScope } from "../../database";
import { writeCloudWatchRecord } from "../../observability/cloudWatch";
import { createBackendObservationScope } from "../../observability/sentry";
import type { AppEnv } from "../../server/app";
import { parseJsonBody } from "../../server/requestParsing";
import { cutHeadAtCodePoint } from "../../shared/codePointCuts";
import { HttpError } from "../../shared/errors";
import {
  chatSandboxSqlRoutePath,
  verifyChatSandboxSqlAuthorization,
  type ChatSandboxSqlCapability,
} from "./capability";

const requestBodySchema = z.object({
  kind: z.enum(["query", "execute"]),
  sql: z.string(),
  workspaceId: z.string().nullable(),
}).strict();

/** Keeps one record far below CloudWatch's event size limit; `sqlChars` still counts the whole statement. */
const maximumLoggedSqlChars = 64_000;

/**
 * A signed capability is not enough on its own: the run it names must still be its session's running
 * run under the claim the worker minted it with, so a stopped, finished or reclaimed run refuses the
 * calls its sandbox still makes.
 */
async function assertChatRunStillActive(capability: ChatSandboxSqlCapability): Promise<void> {
  const scope = { userId: capability.userId, workspaceId: capability.workspaceId };
  const state = await transactionWithWorkspaceScope(scope, async (executor) => getChatRunClaimStateWithExecutor(
    executor,
    { ...scope, runId: capability.runId, sessionId: capability.sessionId, claimToken: capability.claimToken },
  ));
  if (state !== "active") {
    throw new HttpError(
      403,
      "The chat run this command belongs to is no longer running, so its code may not run SQL.",
      "CHAT_SANDBOX_SQL_RUN_INACTIVE",
    );
  }
}

/**
 * One agent SQL call from the code of a `bash` command in the chat sandbox. The `ChatSandbox`
 * capability is the only authentication, so the route reads no session and no CSRF token. A failed
 * statement still answers 200 with the tool's `{ ok: false }` envelope, as the chat tool answers it;
 * any other status means the statement did not run or its answer was lost.
 *
 * One record per call, with the statement but never the rows it read or returned.
 */
export async function handleChatSandboxSqlRequest(context: Context<AppEnv>): Promise<Response> {
  const capability = await verifyChatSandboxSqlAuthorization(context.req.header("authorization"));
  const parsedBody = requestBodySchema.safeParse(await parseJsonBody(context.req.raw));
  if (!parsedBody.success) {
    throw new HttpError(
      400,
      "The body must be { kind: \"query\" | \"execute\", sql: string, workspaceId: string | null }.",
      "CHAT_SANDBOX_SQL_REQUEST_INVALID",
    );
  }

  const body = parsedBody.data;
  await assertChatRunStillActive(capability);
  const call = await executeChatSandboxSqlCall(body.kind, body.sql, body.workspaceId, capability);
  writeCloudWatchRecord({
    action: "chat_sandbox_sql",
    scope: createBackendObservationScope(
      "backend-api",
      context.get("requestId"),
      chatSandboxSqlRoutePath,
      "POST",
      capability.userId,
      capability.workspaceId,
      null,
      capability.runId,
      capability.sessionId,
      null,
      null,
    ),
    details: {
      kind: body.kind,
      explicitWorkspaceId: body.workspaceId,
      sql: cutHeadAtCodePoint(body.sql, maximumLoggedSqlChars),
      sqlChars: body.sql.length,
      ...call.sqlTelemetry,
    },
  }, "breadcrumb");
  return context.body(call.output, 200, { "content-type": "application/json; charset=utf-8" });
}
