import type { DatabaseExecutor } from "../../database";
import type { PostCommitAnalyticsBudget } from "./postCommitBudget";
import {
  emitServerDerivedProductAnalyticsEvents,
  type ServerDerivedProductAnalyticsEvent,
} from "./serverEvents";

export type PostCommitFactBuffer<Fact> = WeakMap<DatabaseExecutor, Array<Fact>>;

export function createPostCommitFactBuffer<Fact>(): PostCommitFactBuffer<Fact> {
  return new WeakMap<DatabaseExecutor, Array<Fact>>();
}

/**
 * Keeps facts with the transaction executor until a committed wrapper takes them for reporting.
 * A failed transaction or a caller that never drains loses only its executor-keyed buffer; it can
 * never report a fact for product data that did not commit.
 */
export function collectPostCommitFact<Fact>(
  buffer: PostCommitFactBuffer<Fact>,
  executor: DatabaseExecutor,
  fact: Fact,
): void {
  const collected = buffer.get(executor);
  if (collected === undefined) {
    buffer.set(executor, [fact]);
    return;
  }

  collected.push(fact);
}

export function takePostCommitFacts<Fact>(
  buffer: PostCommitFactBuffer<Fact>,
  executor: DatabaseExecutor,
): ReadonlyArray<Fact> | undefined {
  const collected = buffer.get(executor);
  if (collected !== undefined) {
    buffer.delete(executor);
  }
  return collected;
}

export type CommittedTransaction<Result> = Readonly<{
  executor: DatabaseExecutor;
  result: Result;
}>;

/**
 * Captures the executor with the transaction result, then drains only after the transaction opener
 * has returned successfully and therefore committed.
 *
 * The no-rejection contract after that commit is load-bearing. A rejection would tell the caller a
 * product operation failed after its data was stored, and a nested producer would also abandon the
 * facts waiting for its later drain. Post-commit resolvers must therefore catch and report their own
 * failures, and the analytics writer represents refusal as a returned outcome rather than a thrown
 * error.
 */
export async function runTransactionWithPostCommitDrain<Result>(
  openTransaction: (
    body: (executor: DatabaseExecutor) => Promise<CommittedTransaction<Result>>,
  ) => Promise<CommittedTransaction<Result>>,
  body: (executor: DatabaseExecutor) => Promise<Result>,
  drain: (committed: CommittedTransaction<Result>) => Promise<void>,
): Promise<Result> {
  const committed = await openTransaction(async (executor) => ({
    executor,
    result: await body(executor),
  }));
  await drain(committed);
  return committed.result;
}

const postCommitFactEmitChunkSize = 500;

export type PostCommitFactEmissionAbortedOutcome = Readonly<{
  status: "aborted";
  reason: "writer_refused" | "budget_exhausted";
  storedEventCount: number;
  failedEventCount: number;
  skippedEventCount: number;
}>;

export type PostCommitFactEmissionOutcome =
  | Readonly<{
      status: "completed";
      storedEventCount: number;
      failedEventCount: 0;
      skippedEventCount: 0;
    }>
  | PostCommitFactEmissionAbortedOutcome;

/**
 * Maps and emits facts in ordered 500-event chunks, one analytics transaction at a time.
 *
 * The shared request budget is checked before every chunk. A spent budget leaves the entire next
 * chunk unattempted; a writer refusal counts that chunk as failed and leaves only later chunks
 * skipped. Chunks stored before either stop remain stored, and the returned counts partition every
 * fact exactly once.
 *
 * The writer never rejects: it logs a refused batch and returns "dropped". Keeping that guarantee
 * here prevents analytics from surfacing as a failure after the product transaction has committed.
 * Event mapping must remain pure so it preserves the same no-rejection contract. Emission is awaited
 * rather than deferred because a Lambda container can be frozen or killed after the response.
 */
export async function emitPostCommitFactEvents<Fact>(
  facts: ReadonlyArray<Fact>,
  budget: PostCommitAnalyticsBudget,
  toEvent: (fact: Fact) => ServerDerivedProductAnalyticsEvent,
): Promise<PostCommitFactEmissionOutcome> {
  for (
    let chunkStart = 0;
    chunkStart < facts.length;
    chunkStart += postCommitFactEmitChunkSize
  ) {
    if (!budget.hasTimeForAnotherOperation()) {
      return {
        status: "aborted",
        reason: "budget_exhausted",
        storedEventCount: chunkStart,
        failedEventCount: 0,
        skippedEventCount: facts.length - chunkStart,
      };
    }

    const chunk = facts.slice(chunkStart, chunkStart + postCommitFactEmitChunkSize);
    const outcome = await emitServerDerivedProductAnalyticsEvents(chunk.map(toEvent));
    if (outcome === "dropped") {
      return {
        status: "aborted",
        reason: "writer_refused",
        storedEventCount: chunkStart,
        failedEventCount: chunk.length,
        skippedEventCount: facts.length - chunkStart - chunk.length,
      };
    }
  }

  return {
    status: "completed",
    storedEventCount: facts.length,
    failedEventCount: 0,
    skippedEventCount: 0,
  };
}
