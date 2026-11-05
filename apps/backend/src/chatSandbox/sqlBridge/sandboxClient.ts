import { setTimeout as sleep } from "node:timers/promises";
import type { Command, ExecResult, decodeBytesToUtf8 } from "just-bash";
import { z } from "zod";
import {
  bridgeRetryDelaysMs,
  describeBridgeOutcome,
  isBridgeAttemptRetryable,
  isUnsentRequestError,
  sendBridgeAttempt,
  type BridgeAttemptOutcome,
} from "../bridgeTransport";
import { maximumSqlCallsPerCommand, type ChatSandboxSqlBridge } from "../contract";

type SqlCallKind = "query" | "execute";

/** The arguments of the `sql_query` and `sql_execute` chat tools. */
const sqlCallArgumentsSchema = z.object({
  sql: z.string(),
  workspaceId: z.string().optional(),
}).strict();

type SqlCallArguments = z.infer<typeof sqlCallArgumentsSchema>;

const sqlCallKindByToolPath: ReadonlyMap<string, SqlCallKind> = new Map<string, SqlCallKind>([
  ["sql.query", "query"],
  ["sql.execute", "execute"],
]);

const toolEnvelopeSchema = z.object({ ok: z.boolean() });

/** A call that did not return the tool's success result; its message is what the command's code sees. */
class ChatSandboxSqlCallError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ChatSandboxSqlCallError";
  }
}

function isWriteOutcomeUnknown(kind: SqlCallKind, outcome: BridgeAttemptOutcome): boolean {
  if (kind === "query") {
    return false;
  }

  return outcome.answered ? outcome.status >= 500 : !isUnsentRequestError(outcome.error);
}

/** The success envelope travels on as it arrived, for js-exec to parse; a failure envelope becomes the error. */
function readToolResult(body: string): string {
  if (!toolEnvelopeSchema.parse(JSON.parse(body)).ok) {
    throw new ChatSandboxSqlCallError(body);
  }

  return body;
}

/**
 * The host end of the chat sandbox's SQL bridge for one `bash` command: `tools.sql.query` and
 * `tools.sql.execute` in js-exec, and the `fc-sql-query` and `fc-sql-execute` commands, all sent to the
 * bridge route with the command's capability. The interpreter's own network stays disabled; python3
 * reaches neither, because just-bash gives its CPython no tool or command bridge.
 */
export class ChatSandboxSqlBridgeClient {
  private sentCalls = 0;
  private sentExecuteCalls = 0;
  private queue: Promise<unknown> = Promise.resolve();

  public constructor(
    private readonly bridge: ChatSandboxSqlBridge,
    private readonly sessionId: string,
  ) {}

  public get callCount(): number {
    return this.sentCalls;
  }

  public get executeCallCount(): number {
    return this.sentExecuteCalls;
  }

  /** js-exec's tool hook: returns the tool's success JSON and throws on every other answer. */
  public async invokeTool(path: string, argsJson: string, signal: AbortSignal): Promise<string> {
    const kind = sqlCallKindByToolPath.get(path);
    if (kind === undefined) {
      throw new ChatSandboxSqlCallError(`There is no tool tools.${path}: use tools.sql.query or tools.sql.execute.`);
    }

    const parsed = sqlCallArgumentsSchema.safeParse(argsJson === "" ? undefined : JSON.parse(argsJson));
    if (!parsed.success) {
      throw new ChatSandboxSqlCallError(`tools.${path} takes one object: { sql: string, workspaceId?: string }.`);
    }

    return this.call(kind, parsed.data, signal);
  }

  public createCommands(decode: typeof decodeBytesToUtf8): ReadonlyArray<Command> {
    return [
      this.createCommand("fc-sql-query", "query", decode),
      this.createCommand("fc-sql-execute", "execute", decode),
    ];
  }

  /** Prints the tool's JSON result, or the failure on stderr with exit code 1. */
  private createCommand(name: string, kind: SqlCallKind, decode: typeof decodeBytesToUtf8): Command {
    return {
      name,
      execute: async (args, context): Promise<ExecResult> => {
        if (args.length > 1) {
          return { stdout: "", stderr: `${name}: pass the statement as one quoted argument or on stdin\n`, exitCode: 2 };
        }

        const sql = args.length === 1 ? args[0] : decode(context.stdin);
        try {
          return { stdout: `${await this.call(kind, { sql }, context.signal)}\n`, stderr: "", exitCode: 0 };
        } catch (error) {
          if (error instanceof ChatSandboxSqlCallError) {
            return { stdout: "", stderr: `${error.message}\n`, exitCode: 1 };
          }

          throw error;
        }
      },
    };
  }

  private async call(kind: SqlCallKind, args: SqlCallArguments, signal: AbortSignal | undefined): Promise<string> {
    if (this.sentCalls >= maximumSqlCallsPerCommand) {
      throw new ChatSandboxSqlCallError(
        `This bash command already made ${maximumSqlCallsPerCommand} SQL calls, the most one command may make: continue the work in another bash command.`,
      );
    }

    this.sentCalls += 1;
    if (kind === "execute") {
      this.sentExecuteCalls += 1;
    }

    return this.runAlone(() => this.send(kind, args, signal));
  }

  /**
   * One call at a time, because `xargs -P` could otherwise send many at once into the API's shared
   * throttle. The queue only orders the calls: each caller still receives its own failure.
   */
  private runAlone(run: () => Promise<string>): Promise<string> {
    const result = this.queue.then(run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async send(kind: SqlCallKind, args: SqlCallArguments, signal: AbortSignal | undefined): Promise<string> {
    const body = JSON.stringify({ kind, sql: args.sql, workspaceId: args.workspaceId ?? null });
    for (let attempt = 1; ; attempt += 1) {
      const outcome = await sendBridgeAttempt({
        url: this.bridge.url,
        method: "POST",
        authorization: this.bridge.authorization,
        contentType: "application/json",
        body,
      }, signal);
      if (outcome.answered && outcome.status === 200) {
        return readToolResult(outcome.body);
      }

      const failure = describeBridgeOutcome(outcome);
      const retryDelayMs = bridgeRetryDelaysMs[attempt - 1];
      if (retryDelayMs === undefined || !isBridgeAttemptRetryable(kind === "query", outcome)) {
        throw new ChatSandboxSqlCallError(isWriteOutcomeUnknown(kind, outcome)
          ? `The SQL bridge did not confirm this write (${failure}), so it may have been applied: read back with a SELECT before sending it again.`
          : `The SQL bridge did not complete this ${kind} call: ${failure}`);
      }

      console.warn({ action: "chat_sandbox_sql_retried", sessionId: this.sessionId, kind, attempt, failure, retryDelayMs });
      await sleep(retryDelayMs, undefined, signal === undefined ? {} : { signal });
    }
  }
}
