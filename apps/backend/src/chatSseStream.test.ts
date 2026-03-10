import assert from "node:assert/strict";
import test from "node:test";
import { createChatSseStream } from "./chat/sse";
import type { ChatStreamEvent } from "./chat/types";

type IntervalHandle = ReturnType<typeof globalThis.setInterval>;
type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

type TimerScheduler = Readonly<{
  setInterval: (callback: () => void, delayMs: number) => IntervalHandle;
  clearInterval: (handle: IntervalHandle) => void;
  setTimeout: (callback: () => void, delayMs: number) => TimeoutHandle;
  clearTimeout: (handle: TimeoutHandle) => void;
}>;

type SchedulerTracker = Readonly<{
  scheduler: TimerScheduler;
  getActiveIntervalCount: () => number;
  getActiveTimeoutCount: () => number;
}>;

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}

function createTrackedScheduler(): SchedulerTracker {
  const activeIntervals = new Set<IntervalHandle>();
  const activeTimeouts = new Set<TimeoutHandle>();

  return {
    scheduler: {
      setInterval(callback: () => void, delayMs: number): IntervalHandle {
        const handle = globalThis.setInterval(callback, delayMs);
        activeIntervals.add(handle);
        return handle;
      },
      clearInterval(handle: IntervalHandle): void {
        activeIntervals.delete(handle);
        globalThis.clearInterval(handle);
      },
      setTimeout(callback: () => void, delayMs: number): TimeoutHandle {
        const handle = globalThis.setTimeout(() => {
          activeTimeouts.delete(handle);
          callback();
        }, delayMs);
        activeTimeouts.add(handle);
        return handle;
      },
      clearTimeout(handle: TimeoutHandle): void {
        activeTimeouts.delete(handle);
        globalThis.clearTimeout(handle);
      },
    },
    getActiveIntervalCount(): number {
      return activeIntervals.size;
    },
    getActiveTimeoutCount(): number {
      return activeTimeouts.size;
    },
  };
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let content = "";

  while (true) {
    const result = await reader.read();
    if (result.done) {
      return content;
    }

    content += decoder.decode(result.value, { stream: true });
  }
}

function countHeartbeats(value: string): number {
  return value.split(": keepalive\n\n").length - 1;
}

test("createChatSseStream emits keepalive comments while the model is silent and clears timers after done", async () => {
  const tracker = createTrackedScheduler();

  async function* events(): AsyncIterableIterator<ChatStreamEvent> {
    await wait(35);
    yield { type: "delta", text: "Hello" };
    yield { type: "done" };
  }

  const stream = createChatSseStream({
    events: events(),
    requestId: "request-id",
    workspaceId: "workspace-id",
    model: "gpt-5.4",
    heartbeatIntervalMs: 10,
    maxDurationMs: 200,
    scheduler: tracker.scheduler,
    now: Date.now,
  });

  const output = await readStream(stream);

  assert.match(output, /data: \{"type":"delta","text":"Hello"\}\n\n/);
  assert.match(output, /data: \{"type":"done"\}\n\n/);
  assert.ok(countHeartbeats(output) >= 2);
  assert.equal(tracker.getActiveIntervalCount(), 0);
  assert.equal(tracker.getActiveTimeoutCount(), 0);
});

test("createChatSseStream emits an SSE error event and clears timers after generator failure", async () => {
  const tracker = createTrackedScheduler();

  async function* events(): AsyncIterableIterator<ChatStreamEvent> {
    await wait(25);
    throw new Error("boom");
  }

  const stream = createChatSseStream({
    events: events(),
    requestId: "request-id",
    workspaceId: "workspace-id",
    model: "gpt-5.4",
    heartbeatIntervalMs: 10,
    maxDurationMs: 200,
    scheduler: tracker.scheduler,
    now: Date.now,
  });

  const output = await readStream(stream);

  assert.ok(countHeartbeats(output) >= 1);
  assert.match(output, /data: \{"type":"error","message":"boom"\}\n\n/);
  assert.equal(tracker.getActiveIntervalCount(), 0);
  assert.equal(tracker.getActiveTimeoutCount(), 0);
});
