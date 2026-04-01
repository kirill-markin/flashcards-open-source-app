import type { Writable } from "node:stream";
import type { LiveSSEEvent } from "./types";

export type LiveDisconnectReason =
  | "close"
  | "finish"
  | "aborted"
  | "stream_error"
  | "write_error";

export type LiveConnectionState = Readonly<{
  isClosed: () => boolean;
  closeReason: () => LiveDisconnectReason | null;
  closeError: () => unknown;
  waitForClose: () => Promise<void>;
  dispose: () => void;
}>;

/**
 * Serializes one typed live event into SSE wire framing.
 */
export function formatSSEEvent(event: LiveSSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Serializes one SSE comment frame.
 */
export function formatSSEComment(comment: string): string {
  return `: ${comment}\n\n`;
}

/**
 * Tracks the writable stream lifecycle so the polling loop can stop as soon as
 * the client disconnects instead of relying on delayed writable flags.
 */
export function createLiveConnectionState(stream: Writable): LiveConnectionState {
  let isClosed = false;
  let closeReason: LiveDisconnectReason | null = null;
  let closeError: unknown = null;
  let resolveCloseWaiters: (() => void) | null = null;
  const closePromise = new Promise<void>((resolve) => {
    resolveCloseWaiters = resolve;
  });

  const markClosed = (reason: LiveDisconnectReason, error: unknown): void => {
    if (isClosed) {
      return;
    }

    isClosed = true;
    closeReason = reason;
    closeError = error;
    resolveCloseWaiters?.();
  };

  const handleClose = (): void => {
    markClosed("close", null);
  };
  const handleFinish = (): void => {
    markClosed("finish", null);
  };
  const handleAborted = (): void => {
    markClosed("aborted", null);
  };
  const handleError = (error: unknown): void => {
    markClosed("stream_error", error);
  };

  stream.on("close", handleClose);
  stream.on("finish", handleFinish);
  stream.on("aborted", handleAborted);
  stream.on("error", handleError);

  return {
    isClosed: () => isClosed,
    closeReason: () => closeReason,
    closeError: () => closeError,
    waitForClose: () => closePromise,
    dispose: () => {
      stream.off("close", handleClose);
      stream.off("finish", handleFinish);
      stream.off("aborted", handleAborted);
      stream.off("error", handleError);
    },
  };
}

/**
 * Returns whether the client connection is still writable right now.
 */
export function isStreamWritable(stream: Writable, connectionState: LiveConnectionState): boolean {
  return connectionState.isClosed() === false
    && stream.destroyed === false
    && stream.writable === true
    && stream.writableEnded === false;
}

/**
 * Waits until the next polling boundary unless the client disconnects first.
 */
export async function waitForNextPollInterval(
  connectionState: LiveConnectionState,
  intervalMs: number,
): Promise<boolean> {
  const sleepPromise = new Promise<boolean>((resolve) => {
    setTimeout(() => {
      resolve(true);
    }, intervalMs);
  });

  return Promise.race([
    sleepPromise,
    connectionState.waitForClose().then(() => false),
  ]);
}
