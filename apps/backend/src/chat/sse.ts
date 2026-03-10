import type { ChatStreamEvent } from "./types";

type ChatStreamCompletion = "done" | "error" | "aborted" | "timeout";

type IntervalHandle = ReturnType<typeof globalThis.setInterval>;
type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

type TimerScheduler = Readonly<{
  setInterval: (callback: () => void, delayMs: number) => IntervalHandle;
  clearInterval: (handle: IntervalHandle) => void;
  setTimeout: (callback: () => void, delayMs: number) => TimeoutHandle;
  clearTimeout: (handle: TimeoutHandle) => void;
}>;

type ChatSseStreamOptions = Readonly<{
  events: AsyncIterable<ChatStreamEvent>;
  requestId: string;
  workspaceId: string;
  model: string;
  heartbeatIntervalMs: number;
  maxDurationMs: number;
  scheduler: TimerScheduler;
  now: () => number;
}>;

const CHAT_HEARTBEAT_FRAME = ": keepalive\n\n";

function getInternalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createChatStreamTimeoutError(maxDurationMs: number): Error {
  const durationMinutes = Math.floor(maxDurationMs / 60_000);
  const error = new Error(`Chat request exceeded the ${durationMinutes}-minute limit.`);
  error.name = "ChatStreamTimeoutError";
  return error;
}

function isChatStreamTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "ChatStreamTimeoutError";
}

function createSseDataFrame(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function logChatStreamSummary(
  requestId: string,
  workspaceId: string,
  model: string,
  durationMs: number,
  heartbeatCount: number,
  completion: ChatStreamCompletion,
  errorMessage: string | null,
): void {
  const logger = completion === "done" ? console.log : console.error;
  logger(JSON.stringify({
    domain: "chat",
    vendor: "backend",
    action: "stream_completed",
    requestId,
    workspaceId,
    model,
    durationMs,
    heartbeatCount,
    heartbeatsSent: heartbeatCount > 0,
    completion,
    errorMessage,
  }));
}

export function createChatSseStream(options: ChatSseStreamOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let iterator: AsyncIterator<ChatStreamEvent> | null = null;
  let iteratorClosed = false;
  let streamEnded = false;
  let logged = false;
  let completion: ChatStreamCompletion = "done";
  let errorMessage: string | null = null;
  let heartbeatCount = 0;
  let heartbeatHandle: IntervalHandle | null = null;
  let timeoutHandle: TimeoutHandle | null = null;
  const startedAt = options.now();

  async function closeIterator(): Promise<void> {
    if (iteratorClosed || iterator === null) {
      return;
    }

    iteratorClosed = true;
    await iterator.return?.();
  }

  function clearTimers(): void {
    if (heartbeatHandle !== null) {
      options.scheduler.clearInterval(heartbeatHandle);
      heartbeatHandle = null;
    }

    if (timeoutHandle !== null) {
      options.scheduler.clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  }

  function logSummary(): void {
    if (logged) {
      return;
    }

    logged = true;
    logChatStreamSummary(
      options.requestId,
      options.workspaceId,
      options.model,
      options.now() - startedAt,
      heartbeatCount,
      completion,
      errorMessage,
    );
  }

  return new ReadableStream({
    async start(controller) {
      iterator = options.events[Symbol.asyncIterator]();
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutHandle = options.scheduler.setTimeout(() => {
          reject(createChatStreamTimeoutError(options.maxDurationMs));
        }, options.maxDurationMs);
      });

      heartbeatHandle = options.scheduler.setInterval(() => {
        if (streamEnded) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(CHAT_HEARTBEAT_FRAME));
          heartbeatCount += 1;
        } catch (error) {
          completion = "aborted";
          errorMessage = getInternalErrorMessage(error);
          streamEnded = true;
          clearTimers();
        }
      }, options.heartbeatIntervalMs);

      try {
        while (!streamEnded) {
          const nextResult = await Promise.race([iterator.next(), timeoutPromise]);
          if (nextResult.done) {
            completion = "done";
            streamEnded = true;
            break;
          }

          controller.enqueue(encoder.encode(createSseDataFrame(nextResult.value)));
          if (nextResult.value.type === "done") {
            completion = "done";
            streamEnded = true;
            break;
          }
        }
      } catch (error) {
        streamEnded = true;
        errorMessage = getInternalErrorMessage(error);
        completion = isChatStreamTimeoutError(error) ? "timeout" : "error";

        try {
          controller.enqueue(encoder.encode(createSseDataFrame({
            type: "error",
            message: errorMessage,
          } satisfies ChatStreamEvent)));
        } catch (enqueueError) {
          completion = "aborted";
          errorMessage = getInternalErrorMessage(enqueueError);
        }
      } finally {
        clearTimers();
        if (completion !== "done") {
          await closeIterator();
        }

        try {
          controller.close();
        } catch {
          // The stream might already be closed when the client disconnects.
        }

        logSummary();
      }
    },
    async cancel() {
      streamEnded = true;
      completion = "aborted";
      clearTimers();
      await closeIterator();
      logSummary();
    },
  });
}
