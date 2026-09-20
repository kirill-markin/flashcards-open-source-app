import {
  ApiError,
  getCachedSessionCsrfToken,
  sendAnalyticsEventsBatch,
  sendAnonymousAnalyticsEvent,
  type AnalyticsIngestResult,
} from "../api";
import { hasLoggedInCookie } from "../appData/session/activation/warmStart";
import { readStoredWebGuestSession } from "../appData/session/guest/webGuestSession";
import type {
  AnalyticsDropReason,
  AnalyticsEvent,
  AnalyticsSurface,
  AnalyticsWireBatch,
} from "./events";
import {
  readAnalyticsAnonymousId,
  readAnalyticsSessionId,
  readStoredAnalyticsEnabled,
  resetAnalyticsSession,
  writeStoredAnalyticsEnabled,
} from "./identity";
import {
  reportAnalyticsInvalidBatch,
  reportAnalyticsQueueDiscardedOnReset,
  reportAnalyticsQueueFailure,
  reportAnalyticsQueueOverflow,
  reportAnalyticsQueueTtlExpiry,
  reportAnalyticsSustainedDeliveryFailure,
} from "./observation";
import {
  appendAnalyticsEvents,
  claimAnalyticsQueueOwner,
  clearAnalyticsQueue,
  readAnalyticsQueueOwner,
  readOldestAnalyticsEvents,
  removeAnalyticsEvents,
  type AnalyticsQueueRecord,
  type QueuedAnalyticsEvent,
} from "./queue";
import {
  hasResolvedAnalyticsVisitorIdentity,
  resolveAnalyticsVisitorIdentity,
} from "./visitorIdentity";
import {
  buildAnalyticsWireContext,
  measureAnalyticsWireEventBytes,
  toAnalyticsTimestamp,
  toAnalyticsWireEvent,
  toAnonymousAnalyticsWireEvent,
} from "./wire";

/** Shared with iOS and Android. */
const batchEventLimit = 50;
const flushThresholdEventCount = 20;
const analyticsEventByteLimit = 4 * 1024;
const retryBaseDelayMs = 1000;
const retryMaxDelayMs = 60 * 60 * 1000;
const sustainedFailureWindowMs = 60 * 60 * 1000;
const periodicFlushIntervalMs = 60 * 1000;
/**
 * Requests one flush may spend. A whole-batch refusal splits and retries, and an unbounded split of a
 * fully refused 50-event batch is ~99 back-to-back requests against a 20 rps endpoint throttle. The
 * budget must stay above the depth needed to isolate one event from a full batch — seven requests for
 * fifty events — or a split could stop before dropping anything and never converge.
 */
const flushRequestBudget = 12;

function readInitialEnabled(): boolean {
  try {
    return readStoredAnalyticsEnabled();
  } catch {
    return true;
  }
}

type AnalyticsDeliveryRuntime = Readonly<{
  isAnalyticsEnabledForCurrentRuntime: () => boolean;
  enqueue: (event: AnalyticsEvent, surface: AnalyticsSurface | null) => void;
  flush: () => void;
  reset: () => void;
  setEnabled: (enabled: boolean) => void;
  startAnalytics: () => () => void;
  setAnalyticsConfirmedOwner: (userId: string) => void;
  readAnalyticsSessionOwnerId: () => string | null;
  registerAnalyticsSessionOwnerPublisher: () => () => void;
}>;

// Background drop reports use the surface at flush time; the facade remains its only owner.
export function createAnalyticsDeliveryRuntime(
  readCurrentSurface: () => AnalyticsSurface | null,
): AnalyticsDeliveryRuntime {
  let isEnabled = readInitialEnabled();
  let pendingRecords: Array<AnalyticsQueueRecord> = [];
  let pendingDropCounts = new Map<AnalyticsDropReason, number>();
  let persistTask: Promise<void> = Promise.resolve();
  let persistTimerId: number | null = null;
  let flushTimerId: number | null = null;
  let flushDueAtMs: number | null = null;
  let trackedSinceFlushCount = 0;
  let consecutiveFailureCount = 0;
  let firstDeliveryFailureAtMs: number | null = null;
  let lastFailureStatusCode: number | null = null;
  let retryNotBeforeMs = 0;
  let isFlushing = false;
  let hasDeliveredInFlush = false;
  let remainingFlushRequestCount = 0;
  /**
   * The account the current credential belongs to, published by the session layer once it has verified
   * the session. The queue stores the account it was filled under, so the two are compared as data
   * rather than trusted to be cleared in the right order: nothing ships until they name one person.
   */
  let confirmedOwnerId: string | null = null;
  /**
   * How many session layers are mounted right now. The session layer is the only thing that confirms
   * an account owner, and it is mounted only under the authenticated app shell, so while this is
   * above zero an account owner can still arrive on this page load and nothing may go out
   * credential-free. That rule is what keeps a signed-in person's `app_opened` on the authenticated
   * ingest: an actor whose `app_opened` rows all came from the collector reads as an actor with no
   * `app_opened` at all and is auto-excluded, with only a human restore to undo it
   * (apps/backend/src/productAnalytics/syntheticActorDetector.ts).
   */
  let sessionOwnerPublisherCount = 0;
  /**
   * Cleared the moment a new owner is published, set again only once the queue's stored owner has been
   * reconciled with it. It never widens what may be sent — the stored-owner comparison in `runFlush` is
   * the guarantee — it only keeps a flush out of the window in which a claim is still deciding what
   * the queue holds.
   */
  let isQueueOwnerReconciled = false;
  /**
   * Bumped every time the queue is torn down, by `reset()`, by the kill switch, or by a newly
   * published owner. A flush captures it at the start and rechecks it before it
   * may send or purge anything, so work started under one identity can never be attributed to, or
   * delete events of, the next one.
   */
  let analyticsGeneration = 0;
  /**
   * Whether this load has settled the question of a stored queue owner nothing can confirm again:
   * either it retired one, or it read the queue and found nothing to retire. It is set only from an
   * answer, so a failed read or a failed clear costs one flush rather than the rest of the load, and
   * it is left alone on a load that is not yet allowed to release at all. Until it is set, every
   * flush asks again, which is what retries both.
   */
  let hasSettledUnconfirmableQueueOwner = false;
  /**
   * Whether this load has already appended its own records to a queue whose retired-guest question
   * it had not yet answered — the release was deferred, or it ran and failed, or it had not run at
   * all. It is one-way for the rest of the load, and it is what `releaseUnconfirmableQueueOwner`
   * refuses to clear on: nothing about an unanswered question is stable inside one document, so the
   * release cannot reason from how it stood when the append happened. Only
   * `hasSettledUnconfirmableQueueOwner` says the question is closed, so only that keeps an append
   * out of the latch.
   *
   * Arming on every unanswered append rather than on a deferred one is deliberate, and it arms more
   * often than the deferral alone would: any load whose first `persistTask` link is a persist rather
   * than a release latches, which a re-entered `startAnalytics()` on this module singleton can do
   * when `runFlush` returns early on an armed `retryNotBeforeMs`. What that costs is waiting — this
   * load's events sit in the dead guest's queue until a later load retires it, and are discarded
   * with it — and waiting is recoverable in a way the clear is not: a clear that runs under a load
   * already recording into that queue destroys records nothing reported as lost.
   */
  let hasPersistedUnderUnsettledQueueOwner = false;

  function isAnalyticsEnabledForCurrentRuntime(): boolean {
    return isEnabled;
  }

  /** Losses are counted here and emitted as `analytics_events_dropped` on the next flush. */
  function countDropped(reason: AnalyticsDropReason, count: number): void {
    if (count <= 0) {
      return;
    }

    pendingDropCounts.set(reason, (pendingDropCounts.get(reason) ?? 0) + count);
  }

  function enqueueEvent(event: AnalyticsEvent, surface: AnalyticsSurface | null): void {
    const nowMs = Date.now();
    const sessionId = readAnalyticsSessionId(nowMs);
    const wireEvent = toAnalyticsWireEvent(event, nowMs, surface);
    const byteSize = measureAnalyticsWireEventBytes(wireEvent);
    if (byteSize > analyticsEventByteLimit) {
      countDropped("rejected", 1);
      return;
    }

    pendingRecords.push({
      eventId: wireEvent.eventId,
      sessionId,
      createdAtMs: nowMs,
      byteSize,
      wireEvent,
    });
  }

  function persistPendingRecords(): Promise<void> {
    persistTask = persistTask.then(async (): Promise<void> => {
      if (pendingRecords.length === 0) {
        return;
      }

      const records = pendingRecords;
      pendingRecords = [];
      // The one place anything this load tracked reaches the stored queue — `appendAnalyticsEvents`
      // has no other caller — and it runs on the same `persistTask` chain as the release, so a
      // release either sees this append or is ordered before it. Latched before the append is
      // awaited, because a rejected append may still have written.
      //
      // The condition is the settled flag alone. Whether the release was deferred at this moment
      // says nothing: a release that was allowed but threw, or one that has not run yet, leaves the
      // same open question and the same records exposed to the clear the next flush may perform.
      if (hasSettledUnconfirmableQueueOwner === false) {
        hasPersistedUnderUnsettledQueueOwner = true;
      }

      try {
        const overflowCount = await appendAnalyticsEvents(records);
        if (overflowCount > 0) {
          countDropped("queue_overflow", overflowCount);
          reportAnalyticsQueueOverflow(overflowCount);
        }
      } catch (error) {
        reportAnalyticsQueueFailure(error);
      }
    });
    return persistTask;
  }

  function schedulePersist(): void {
    if (persistTimerId !== null) {
      return;
    }

    // Coalesces a burst of tracked events into one IndexedDB transaction, off the interaction path.
    persistTimerId = window.setTimeout((): void => {
      persistTimerId = null;
      try {
        void persistPendingRecords();
        if (trackedSinceFlushCount >= flushThresholdEventCount) {
          scheduleFlush(0);
        }
      } catch {
        // Nothing scheduled by analytics may surface as an uncaught error.
      }
    }, 0);
  }

  function createBackoffDelayMs(failureCount: number): number {
    const exponentialDelayMs = retryBaseDelayMs * 2 ** (failureCount - 1);
    const cappedDelayMs = Math.min(exponentialDelayMs, retryMaxDelayMs);
    return Math.floor(Math.random() * cappedDelayMs);
  }

  function scheduleFlush(delayMs: number): void {
    const dueAtMs = Date.now() + delayMs;
    if (flushTimerId !== null && flushDueAtMs !== null && flushDueAtMs <= dueAtMs) {
      return;
    }

    if (flushTimerId !== null) {
      window.clearTimeout(flushTimerId);
    }

    flushDueAtMs = dueAtMs;
    flushTimerId = window.setTimeout((): void => {
      flushTimerId = null;
      flushDueAtMs = null;
      try {
        void runFlush();
      } catch {
        // Nothing scheduled by analytics may surface as an uncaught error.
      }
    }, delayMs);
  }

  function drainDropReports(): void {
    if (pendingDropCounts.size === 0) {
      return;
    }

    const dropCounts = [...pendingDropCounts.entries()];
    pendingDropCounts = new Map<AnalyticsDropReason, number>();
    for (const [reason, count] of dropCounts) {
      enqueueEvent({ name: "analytics_events_dropped", reason, count }, readCurrentSurface());
    }
  }

  /**
   * The wire envelope carries one session id for the whole batch, so a batch stops at the first event
   * from a different session.
   */
  function takeLeadingSessionRun(
    events: ReadonlyArray<QueuedAnalyticsEvent>,
  ): ReadonlyArray<QueuedAnalyticsEvent> {
    const batchSessionId = events[0].sessionId;
    const boundaryIndex = events.findIndex((event) => event.sessionId !== batchSessionId);
    return boundaryIndex === -1 ? events : events.slice(0, boundaryIndex);
  }

  function buildWireBatch(events: ReadonlyArray<QueuedAnalyticsEvent>): AnalyticsWireBatch {
    return {
      // Stamped at request time, not at event time: the server derives every stored `occurred_at` from
      // the interval between this and each event's `clientOccurredAt`.
      clientSentAt: toAnalyticsTimestamp(Date.now()),
      anonymousId: readAnalyticsAnonymousId(),
      sessionId: events[0].sessionId,
      context: buildAnalyticsWireContext(),
      events: events.map((event) => event.wireEvent),
    };
  }

  function trackSustainedDeliveryFailure(statusCode: number): void {
    const nowMs = Date.now();
    if (firstDeliveryFailureAtMs === null) {
      firstDeliveryFailureAtMs = nowMs;
      return;
    }

    if (nowMs - firstDeliveryFailureAtMs > sustainedFailureWindowMs) {
      reportAnalyticsSustainedDeliveryFailure(statusCode);
    }
  }

  /**
   * Removing sent events is a local queue operation, not part of delivery: a failure here must be
   * reported as the storage failure it is instead of arming the transport backoff as if the server had
   * refused the batch. Returns whether the queue actually shrank, because a failed purge would
   * otherwise let the backlog drain re-read and resend the same events without end.
   */
  async function purgeSentEvents(events: ReadonlyArray<QueuedAnalyticsEvent>): Promise<boolean> {
    try {
      await removeAnalyticsEvents(events);
      return true;
    } catch (error) {
      reportAnalyticsQueueFailure(error);
      return false;
    }
  }

  /**
   * A batch carrying nothing but `analytics_events_dropped`. Counting its refusal would emit a fresh
   * drop event that the same refusal takes out again: the queue never changes and the client posts
   * forever at whatever rate its loop allows. The whole-batch and the per-event refusal paths share
   * this one rule so neither can be closed without the other.
   */
  function isDropOnlyBatch(events: ReadonlyArray<QueuedAnalyticsEvent>): boolean {
    return events.every((event) => event.wireEvent.eventName === "analytics_events_dropped");
  }

  async function handleDeliveryFailure(
    error: unknown,
    events: ReadonlyArray<QueuedAnalyticsEvent>,
    flushGeneration: number,
  ): Promise<void> {
    // The queue these events came from has been discarded. Nothing here may purge from, count against,
    // or arm a backoff for the identity that replaced it.
    if (flushGeneration !== analyticsGeneration) {
      return;
    }

    const statusCode = error instanceof ApiError ? error.statusCode : 0;

    // 400 and 413 refuse the whole batch and carry no per-event report. Resending the same bytes fails
    // identically forever, so the batch is split until a single poison event is isolated and dropped.
    if (statusCode === 400 || statusCode === 413) {
      reportAnalyticsInvalidBatch(statusCode);
      if (events.length === 1) {
        await purgeSentEvents(events);
        // A refused drop event must not regenerate itself. Only this one rejection goes uncounted:
        // losses counted elsewhere in the same flush are untouched, so a real `queue_overflow` or
        // `ttl_expired` count is still carried into the next drop event.
        if (isDropOnlyBatch(events) === false) {
          countDropped("rejected", 1);
        }

        return;
      }

      const midpoint = Math.ceil(events.length / 2);
      await deliverBatch(events.slice(0, midpoint), flushGeneration);
      await deliverBatch(events.slice(midpoint), flushGeneration);
      return;
    }

    // Everything else keeps the events queued: 429 and 5xx are transient, and 401, 403 and 410 wait
    // for a future valid credential rather than spinning.
    if (statusCode === 429 || statusCode >= 500) {
      trackSustainedDeliveryFailure(statusCode);
    }

    consecutiveFailureCount += 1;
    lastFailureStatusCode = statusCode;
    // `Retry-After` is an optimisation, never a precondition: only the analytics writer's own 429 and
    // 503 carry it, and the gateway throttle's 429 never does.
    const retryAfterMs = error instanceof ApiError ? error.retryAfterMs : null;
    const delayMs = retryAfterMs ?? createBackoffDelayMs(consecutiveFailureCount);
    retryNotBeforeMs = Date.now() + delayMs;
    scheduleFlush(delayMs);
  }

  /**
   * Whether an authenticated batch may go out right now. Failure-closed: a confirmed owner whose
   * CSRF token is not loaded yet would be refused with 403 on every batch.
   */
  function hasSendableSessionCredential(): boolean {
    return confirmedOwnerId !== null && getCachedSessionCsrfToken() !== null;
  }

  /**
   * Whether the queued events may go out on the credential-free collector instead.
   *
   * Only events collected under no owner at all, on a browser that says no account owns it and on a
   * load where none can still arrive. An account's queued events must keep the `user_id` their
   * credential gives them, and a signed-in person must never report `app_opened` credential-free:
   * `logged_in` is read beside the mounted session layer because it is set from the first paint of
   * the load that follows a sign-in, while the session layer mounts a commit or more later, and the
   * first flush of that load is exactly where the cold `app_opened` sits. What that costs is a
   * visitor who signed in once and browses the public routes signed out: their events wait in the
   * queue instead of being reported as a visitor's, and are adopted by their next sign-in. All four
   * facts are read live on every flush, so a 401 from `POST /api/refresh-session` that clears
   * `logged_in` and the cached CSRF token mid-load opens this path for what is tracked afterwards,
   * which is right — that browser no longer holds a credential — and is also why retiring a stored
   * queue owner cannot assume it stays deferred (`releaseUnconfirmableQueueOwner`).
   *
   * The visitor identity is resolved first, so the first page view carries the shared cookie id
   * rather than the per-tab fallback behind it.
   */
  function canDeliverWithoutCredential(queuedOwnerId: string | null): boolean {
    return confirmedOwnerId === null
      && queuedOwnerId === null
      && sessionOwnerPublisherCount === 0
      && hasLoggedInCookie() === false
      && getCachedSessionCsrfToken() === null
      && hasResolvedAnalyticsVisitorIdentity();
  }

  /**
   * Whether retiring a stored queue owner has to wait: an account credential exists, or one can
   * still arrive on this load. Read live on every flush that has not settled the question, because
   * none of the four facts is stable within a document. Deliberately not read by the persist latch:
   * a deferral is only one of the ways a flush can leave the question open, so the latch arms on the
   * open question itself.
   */
  function isQueueOwnerReleaseDeferred(): boolean {
    return confirmedOwnerId !== null
      || sessionOwnerPublisherCount !== 0
      || hasLoggedInCookie()
      || getCachedSessionCsrfToken() !== null;
  }

  /**
   * Retires a stored queue owner no credential can ever name again, which would otherwise block both
   * transports until an account is next confirmed on this browser.
   *
   * Earlier builds published this browser's web guest id as the analytics queue owner. Nothing
   * publishes one any more, so such a queue fails the authenticated gate — no owner will ever equal
   * it — and fails the credential-free gate, which requires an unclaimed queue. Every flush would
   * return sending nothing, and the events would die of the 14-day TTL: exactly the returning
   * signed-out browsers the shared visitor identity exists to measure.
   *
   * It runs only where no account credential exists and none can still arrive on this load — the
   * same facts `canDeliverWithoutCredential` reads, minus the owner this releases and minus the
   * visitor identity, which retiring a dead owner does not need — so a real account's queue is never
   * touched. An account owner is deliberately not released: it can be
   * confirmed again by the next sign-in, which is what adopts those events.
   *
   * The queued events go with the owner rather than being re-sent under the visitor id: they were
   * collected under that dead credential, and the only releaser the queue has empties it. The
   * discard is not reported, for the same reason the kill switch's is not — it is the documented
   * one-time effect of retiring the web guest, not a loss anybody needs to be told about.
   *
   * The clear empties whatever the store holds when it runs, and the ordering that keeps this load's
   * records out of it is the `persistTask` link: the release takes it synchronously, before it
   * awaits anything, so every append behind that link — this flush's own, the coalescing timer's, a
   * page-hide one — lands in the cleared, unowned queue. On the first flush of a load that link is
   * normally taken before the coalescing timer has run, so what the clear takes is the retired
   * guest's events and nothing this load tracked. Normally, not always: an append can precede the
   * first release link, and what protects those records is the latch below rather than this
   * ordering. It does not promise those events leave on this flush: only what
   * `readOldestAnalyticsEvents` already saw is sent and a later append waits for the next flush, and
   * a signed-out browser sends nothing at all until the shared visitor identity has settled
   * (`canDeliverWithoutCredential`), which on a first visit is still a network `GET` away — the
   * flush behind `startVisitorIdentityResolution` is what ships them.
   *
   * A release the guard below defers past this load's first append would, whenever it finally ran,
   * take that append with it, and the guard really does turn from deferred into allowed inside one
   * document. `logged_in` is not written only by a navigation: the 401 answer to
   * `POST /api/refresh-session` clears it in place (`sessionRecovery.ts`, and
   * `clearBrowserSessionCookies` in `apps/auth/src/server/browserSession.ts`), the cookie is
   * `Lax`, non-`HttpOnly` and on the shared registrable domain, and `hasLoggedInCookie()` re-reads
   * it on every call. That same 401 path nulls the cached CSRF token afterwards, so the token is
   * not guaranteed to be the first of the four to clear either, and
   * `sessionOwnerPublisherCount` reaches zero without leaving the page when a render crash unmounts
   * `AppDataProvider` under the single root `AppErrorBoundary` (`App.tsx`).
   *
   * `hasPersistedUnderUnsettledQueueOwner` is what makes that safe instead of an ordering argument:
   * any persist that ran before this load settled the question blocks the clear for the rest of the
   * load, so the clear only ever discards records that predate the load running it. It latches on
   * the unanswered question rather than on the deferral, because the guard below is not the only way
   * to reach a flush that has not answered it — a release that was allowed and then threw leaves it
   * just as open, with this load's coalescing timer free to persist into the queue meanwhile. The
   * cost is that such a load's own events wait in the dead guest's queue — nothing can ship them
   * under that owner, and the later load that finally retires it discards them too — rather than
   * being deleted underneath the load that is still recording into them, unreported and mid-flight.
   *
   * `discardQueuedWork` is deliberately not used here: it also empties `pendingRecords`, which on a
   * first flush is exactly the cold `app_opened` and the first `screen_viewed`.
   *
   * Returns whether the flush may go on to persist and read. A failed read or a failed clear leaves
   * the owner in place, so the caller stops instead of appending this load's records to a queue that
   * is still going to be emptied; the next flush of this load asks again. Stopping the flush keeps
   * its own append out of the queue, and an append the coalescing timer made in between latches
   * instead, so that next attempt finds the question still open and refuses to clear rather than
   * taking the timer's records with it. That retry is deliberately not a `scheduleFlush(0)` from
   * here: a clear that kept failing would then reschedule itself at zero delay on every attempt.
   */
  function releaseUnconfirmableQueueOwner(): Promise<boolean> {
    if (hasSettledUnconfirmableQueueOwner) {
      return Promise.resolve(true);
    }

    if (isQueueOwnerReleaseDeferred()) {
      // Deliberately not settled, because the guard is re-read on every flush and nothing here has
      // to decide for the rest of the load. It is re-read precisely because a load does turn from
      // deferred into allowed in place — a 401 from `POST /api/refresh-session` clears `logged_in`
      // and then the cached CSRF token, a crash unmounts the session layer — and what keeps such a
      // flush from clearing this load's own records is the latch above, not this return; the latch
      // does not read this guard, so it covers an append made under any unanswered question. A load
      // that holds a credential does not need the release anyway — a confirmed owner's
      // `claimQueueOwner` replaces a foreign owner itself, and reports what that discards.
      return Promise.resolve(true);
    }

    // Chained onto the persist task like every other queue operation, and the link is taken before
    // this function awaits anything, which is what puts every later append behind the clear.
    const releaseTask = persistTask.then(async (): Promise<boolean> => {
      try {
        const queuedOwnerId = await readAnalyticsQueueOwner();
        // Naming the retired guest is what makes this release safe, and the stored envelope is the
        // only thing on this browser that can: an owner it cannot name is left alone, because
        // widening the condition to "an owner this browser cannot name" would eventually release a
        // confirmable account owner. The envelope usually outlives the queue owner it was published
        // as, but not always — a sign-in that drops it can leave its own `claimQueueOwner` rejected
        // — and such a queue keeps the guest owner until an account is confirmed on this browser
        // again.
        if (queuedOwnerId === null || readStoredWebGuestSession()?.userId !== queuedOwnerId) {
          hasSettledUnconfirmableQueueOwner = true;
          return true;
        }

        if (hasPersistedUnderUnsettledQueueOwner) {
          // This load already wrote into this queue while the question this answers was still open,
          // so the clear would take its records too. The owner stays, which blocks both transports
          // for the rest of the load as a signed-out browser — a sign-in still reopens the
          // authenticated path, because `claimQueueOwner` replaces a foreign owner itself.
          // Deliberately not settled, so nothing else reads this as a finished release. A later
          // load that settles the question before its first append retires the owner.
          return true;
        }

        analyticsGeneration += 1;
        await clearAnalyticsQueue(true);
        hasSettledUnconfirmableQueueOwner = true;
        return true;
      } catch (error) {
        reportAnalyticsQueueFailure(error);
        return false;
      }
    });
    persistTask = releaseTask.then((): void => undefined);
    return releaseTask;
  }

  async function deliverBatch(
    events: ReadonlyArray<QueuedAnalyticsEvent>,
    flushGeneration: number,
  ): Promise<void> {
    // Rechecked synchronously immediately before the batch is built, and nothing between this line and
    // the request may await: `buildWireBatch` reads the current `anonymousId`, so a `reset()` landing
    // in the queue round trips above would otherwise ship the previous account's events under the next
    // account's id. The server resolves `analytics.identity_links` first-link-wins on an append-only
    // table, so that merge of two people is permanent and has no repair path. The same check covers
    // the credential: every owner change bumps the generation, so one that landed after the gate in
    // `runFlush` read it stops this batch instead of letting it out on the previous identity's token.
    if (flushGeneration !== analyticsGeneration) {
      return;
    }

    // A 429 or a transport failure earlier in this split armed a backoff; the rest of the split honours
    // it instead of firing the delay away on the same stack.
    if (Date.now() < retryNotBeforeMs) {
      return;
    }

    // What the budget cuts short stays queued and is picked up by the next flush, which still
    // converges because every refused single event leaves the queue.
    if (remainingFlushRequestCount <= 0) {
      return;
    }

    remainingFlushRequestCount -= 1;

    let result: AnalyticsIngestResult;
    try {
      result = await sendAnalyticsEventsBatch(buildWireBatch(events));
    } catch (error) {
      await handleDeliveryFailure(error, events, flushGeneration);
      return;
    }

    consecutiveFailureCount = 0;
    firstDeliveryFailureAtMs = null;
    lastFailureStatusCode = null;
    retryNotBeforeMs = 0;
    // A reset landed while the request was in flight; it already discarded everything that was sent,
    // and the loss was accounted for there.
    if (flushGeneration !== analyticsGeneration) {
      return;
    }

    // A 200 finishes the batch: `accepted` is a count only and rejected events are permanently
    // refused, so every event that was sent leaves the queue.
    hasDeliveredInFlush = await purgeSentEvents(events);
    // The same exemption the whole-batch refusal above applies. A per-event refusal of
    // `analytics_events_dropped` inside a 200 — a catalog change rather than a defect in this client —
    // would otherwise purge one drop event and emit another for a net-zero queue, turning a silent
    // client into one request per periodic tick forever. Suppressing only this batch's count leaves a
    // `queue_overflow` or `ttl_expired` accrued elsewhere in the same flush intact.
    if (isDropOnlyBatch(events) === false) {
      countDropped("rejected", result.rejectedCount);
    }
  }

  /**
   * Ships what a signed-out browser collected, through the credential-free collector: one request
   * per event, because that is the shape that route accepts (docs/anonymous-client-analytics.md).
   * The identity on those rows is the shared visitor id alone, and the server counts them as
   * evidence that an event happened rather than as evidence that a person exists.
   */
  async function deliverAnonymousEvents(
    events: ReadonlyArray<QueuedAnalyticsEvent>,
    flushGeneration: number,
  ): Promise<void> {
    for (const event of events) {
      // The three preconditions `deliverBatch` rechecks before every request, for the same reasons: a
      // reset may not be outrun, a backoff armed by an earlier event in this loop is honoured rather
      // than fired away on the same stack, and the request budget bounds one flush.
      if (flushGeneration !== analyticsGeneration || Date.now() < retryNotBeforeMs) {
        return;
      }

      if (remainingFlushRequestCount <= 0) {
        // Unlike a batch, one request carries one event, so a budget that runs out here leaves a
        // remainder the outer remainder check cannot see.
        scheduleFlush(0);
        return;
      }

      remainingFlushRequestCount -= 1;
      try {
        await sendAnonymousAnalyticsEvent(toAnonymousAnalyticsWireEvent(event.wireEvent, Date.now()));
      } catch (error) {
        // A refusal already names a single event here, so the whole-batch split in
        // `handleDeliveryFailure` isolates nothing and drops it straight away.
        await handleDeliveryFailure(error, [event], flushGeneration);
        continue;
      }

      consecutiveFailureCount = 0;
      firstDeliveryFailureAtMs = null;
      lastFailureStatusCode = null;
      retryNotBeforeMs = 0;
      if (flushGeneration !== analyticsGeneration) {
        return;
      }

      hasDeliveredInFlush = await purgeSentEvents([event]);
      if (hasDeliveredInFlush === false) {
        // The queue is unusable, so a repeat would re-send what was just accepted on every flush.
        return;
      }
    }
  }

  async function runFlush(): Promise<void> {
    if (isEnabled === false || isFlushing) {
      return;
    }

    const nowMs = Date.now();
    if (nowMs < retryNotBeforeMs) {
      scheduleFlush(retryNotBeforeMs - nowMs);
      return;
    }

    isFlushing = true;
    trackedSinceFlushCount = 0;
    try {
      // Ahead of the appends this flush goes on to make, which take their place on `persistTask`
      // behind the link this takes. A queue owner nothing can confirm again is retired here, so the
      // records appended below land in a cleared, unowned queue rather than in the dead guest's.
      // Ordering is not what protects an append this load already made — the coalescing timer can
      // have taken the first link, and on a first flush it usually has not — the latch is: where
      // anything of this load's was persisted before the question was answered, the release refuses
      // to clear instead, what is already queued waits for a later load rather than being deleted
      // under this one, and nothing ships until then. A release that could not finish stops the
      // flush, and the next one asks again.
      const mayFlush = await releaseUnconfirmableQueueOwner();
      if (mayFlush === false) {
        return;
      }

      const flushGeneration = analyticsGeneration;
      drainDropReports();
      await persistPendingRecords();

      const queued = await readOldestAnalyticsEvents(batchEventLimit, Date.now());
      if (queued.expiredCount > 0) {
        countDropped("ttl_expired", queued.expiredCount);
        reportAnalyticsQueueTtlExpiry(queued.expiredCount);
      }

      if (queued.events.length === 0) {
        return;
      }

      // Which of the two transports these events may leave on, decided from recorded facts rather
      // than from an assumption about when the session layer's cleanup happens to run: the owner
      // comes back from the same transaction that produced the events. An authenticated batch needs
      // the queue's owner and the published one to name the same account; everything else either
      // goes out with no credential at all or waits, and waiting only holds events in the queue
      // under their 14-day TTL until a later load can place them.
      hasDeliveredInFlush = false;
      remainingFlushRequestCount = flushRequestBudget;
      const sendableEvents = takeLeadingSessionRun(queued.events);
      if (
        isQueueOwnerReconciled
        && queued.ownerId === confirmedOwnerId
        && hasSendableSessionCredential()
      ) {
        await deliverBatch(sendableEvents, flushGeneration);
      } else if (canDeliverWithoutCredential(queued.ownerId)) {
        await deliverAnonymousEvents(sendableEvents, flushGeneration);
      } else {
        // Waiting is the usual outcome here, and correct: these events stay queued under their
        // 14-day TTL until a load can place them. The one queue that would wait forever is one whose
        // owner nothing can confirm again, and that one was already retired at the top of the flush.
        return;
      }

      // More events are waiting either because the read filled the batch limit, or because a session
      // boundary cut the sent run short. Both drain immediately: a backlog that crossed several
      // sessions would otherwise advance by one session run per periodic timer tick.
      const hasQueuedRemainder = queued.events.length >= batchEventLimit
        || sendableEvents.length < queued.events.length;
      if (hasDeliveredInFlush && hasQueuedRemainder) {
        scheduleFlush(0);
      }
    } catch (error) {
      reportAnalyticsQueueFailure(error);
    } finally {
      isFlushing = false;
    }
  }

  /**
   * Reconciles the queue's stored owner with the published one. A queue that turns out to belong to
   * somebody else is discarded here rather than being shipped under the new credential:
   * `analytics.identity_links` resolves first-link-wins on an append-only table, so fusing two people
   * there is permanent and has no repair path. The identity itself is not rotated with it: it is the
   * shared visitor cookie, one browser's id across accounts and across a sign-in.
   */
  function claimQueueOwner(userId: string): void {
    // Chained onto the persist task like every other queue operation, so a claim can neither interleave
    // with a write nor leave the chain rejected for the writes behind it.
    persistTask = persistTask.then(async (): Promise<void> => {
      try {
        const claim = await claimAnalyticsQueueOwner(userId);
        if (claim.didReplaceForeignOwner && claim.discardedEventCount > 0) {
          reportAnalyticsQueueDiscardedOnReset(claim.discardedEventCount);
        }

        // A newer owner was published while this claim ran; its own claim opens the gate instead.
        if (confirmedOwnerId !== userId) {
          return;
        }

        isQueueOwnerReconciled = true;
        scheduleFlush(0);
      } catch (error) {
        // The store is unusable, so there is nothing readable to ship either; the gate stays shut.
        reportAnalyticsQueueFailure(error);
      }
    });
  }

  /**
   * Announces the session layer for as long as it is mounted, and returns the release. While it is
   * mounted an account owner can still be published on this page load, and nothing may go out
   * credential-free until either it arrives or the layer is gone.
   */
  function registerAnalyticsSessionOwnerPublisher(): () => void {
    sessionOwnerPublisherCount += 1;
    let isReleased = false;
    return (): void => {
      // A double release would decrement the count below the publishers that are still mounted, and
      // this guard fails closed: the count only ever over-reports, never under-reports.
      if (isReleased) {
        return;
      }

      isReleased = true;
      sessionOwnerPublisherCount -= 1;
    };
  }

  /**
   * Publishes the account the current credential belongs to. Call it wherever the session layer has
   * verified a session; publishing late only delays delivery, and never publishing at all only holds
   * the account's events in the queue for the next page load, because nothing authenticated is sent
   * until a published owner and the queue's stored owner name the same person.
   */
  function setAnalyticsConfirmedOwner(userId: string): void {
    try {
      if (confirmedOwnerId === userId) {
        return;
      }

      // Shuts the gate and invalidates any flush already in flight before the claim can touch a
      // record: work started under the previous owner may no longer send or purge from here.
      confirmedOwnerId = userId;
      isQueueOwnerReconciled = false;
      analyticsGeneration += 1;
      consecutiveFailureCount = 0;
      firstDeliveryFailureAtMs = null;
      lastFailureStatusCode = null;
      retryNotBeforeMs = 0;
      claimQueueOwner(userId);
    } catch {
      // The gate is already shut; a failure here can only cost delivery, never misattribute an event.
    }
  }

  /**
   * The account the session layer has published as this browser's analytics owner, or null while none
   * is published — before the first verified session, and after `reset()` tore one down.
   *
   * It exists for background work that was started for one account and must not finish under another:
   * this is the one place the app names, module-side and synchronously, who the current credential
   * belongs to. `setAnalyticsConfirmedOwner` is the only writer, so a reader here sees the switch the
   * moment the session layer publishes it rather than when React state reaches a component.
   */
  function readAnalyticsSessionOwnerId(): string | null {
    return confirmedOwnerId;
  }

  function enqueue(event: AnalyticsEvent, surface: AnalyticsSurface | null): void {
    if (isEnabled === false) {
      return;
    }

    enqueueEvent(event, surface);
    trackedSinceFlushCount += 1;
    schedulePersist();
  }

  function flush(): void {
    void runFlush();
  }

  /**
   * Asks for the shared visitor identity and flushes once it has settled: reporting with no
   * credential waits for that, so this is what releases a signed-out browser's first page view. One
   * answer is asked for once; `resolveAnalyticsVisitorIdentity` re-asks only after a call that threw
   * and only under its own bounds, so calling this on every connectivity change and every periodic
   * tick costs nothing once the identity has settled. Never awaited and never on a render path,
   * because a first visit can pay a GeoLite download inside the request. The kill switch is an
   * explicit opt-out and this call can set a 13-month cookie, so an opted-out browser asks for
   * nothing.
   */
  function startVisitorIdentityResolution(): void {
    if (isEnabled === false) {
      return;
    }

    void resolveAnalyticsVisitorIdentity().then((): void => {
      flush();
    });
  }

  /**
   * Starts the IndexedDB write for everything tracked so far instead of waiting for the coalescing
   * timer. The page-hide paths run it right after the collectors have emitted their closing events: the
   * `setTimeout` that normally batches the write never gets a chance to run once the page is going away.
   */
  function persistTrackedAnalyticsEvents(): void {
    try {
      if (persistTimerId !== null) {
        window.clearTimeout(persistTimerId);
        persistTimerId = null;
      }

      void persistPendingRecords();
    } catch {
      // Nothing scheduled by analytics may surface as an uncaught error.
    }
  }

  function sumPendingDropCounts(): number {
    let total = 0;
    for (const count of pendingDropCounts.values()) {
      total += count;
    }

    return total;
  }

  function discardQueuedWork(shouldReportDiscard: boolean, shouldReleaseOwner: boolean): void {
    // Invalidates any flush already in flight before a single record is touched, so it can neither
    // send the discarded events under the next identity nor delete records belonging to it.
    analyticsGeneration += 1;
    // Counted before the queue is emptied: an unreported drop is itself a silent loss.
    const unreportedLossCount = pendingRecords.length + sumPendingDropCounts();
    pendingRecords = [];
    pendingDropCounts = new Map<AnalyticsDropReason, number>();
    consecutiveFailureCount = 0;
    firstDeliveryFailureAtMs = null;
    lastFailureStatusCode = null;
    retryNotBeforeMs = 0;
    persistTask = persistTask.then(async (): Promise<void> => {
      try {
        const clearedEventCount = await clearAnalyticsQueue(shouldReleaseOwner);
        const discardedEventCount = unreportedLossCount + clearedEventCount;
        if (shouldReportDiscard && discardedEventCount > 0) {
          reportAnalyticsQueueDiscardedOnReset(discardedEventCount);
        }
      } catch (error) {
        reportAnalyticsQueueFailure(error);
      }
    });
  }

  /**
   * Signing out leaves for the auth origin, so every
   * caller of this function runs on a *later* app start: `logout_marker` and `account_deleted_marker`
   * run when the credential is already gone, and `confirmed_account_switch` / `reauth_owner_unknown`
   * run right after `getSession()` returned a session belonging to somebody else. Flushing there would
   * post the previous account's events on the new account's credential, which is exactly the
   * unrepairable identity merge the whole reset path exists to prevent.
   */
  function reset(): void {
    try {
      // The stored queue owner is released with the events: the next account confirmed on this browser
      // then adopts an empty queue instead of inheriting one. Until one is confirmed the events this
      // browser reports next are the signed-out visitor's, and they go out credential-free under the
      // shared visitor id, which is deliberately the same id across the boundary: it belongs to the
      // browser rather than to whoever was signed in.
      confirmedOwnerId = null;
      isQueueOwnerReconciled = false;
      discardQueuedWork(true, true);
      resetAnalyticsSession();
    } catch {
      // Logout cleanup must not fail because analytics could not reset.
    }
  }

  /** Kill switch. Honored immediately and remembered, so analytics can be turned off without a release. */
  function setEnabled(enabled: boolean): void {
    try {
      isEnabled = enabled;
      writeStoredAnalyticsEnabled(enabled);
      if (enabled === false) {
        // Not reported: turning analytics off is a deliberate operator action, and the discard is its
        // documented effect rather than a loss anybody needs to be told about. The stored queue owner
        // is kept, because the queue is emptied rather than handed to somebody else, so turning
        // analytics back on does not have to wait for another verification to publish one.
        discardQueuedWork(false, false);
        return;
      }

      // Turning analytics back on is also the first moment a browser that booted opted-out may ask
      // for the shared identity.
      startVisitorIdentityResolution();
      scheduleFlush(0);
    } catch {
      // The in-memory flag already took effect.
    }
  }

  function startAnalytics(): () => void {
    startVisitorIdentityResolution();

    function handleVisibilityChange(): void {
      if (document.visibilityState === "hidden") {
        persistTrackedAnalyticsEvents();
        flush();
      }
    }

    function handleOnline(): void {
      // Connectivity returning is exactly the signal a transport backoff was waiting for; a throttle
      // or server backoff keeps its delay.
      if (lastFailureStatusCode === 0) {
        consecutiveFailureCount = 0;
        lastFailureStatusCode = null;
        retryNotBeforeMs = 0;
      }

      // A browser that was offline when it asked for the identity has nothing to flush until it has
      // one: the credential-free gate stays shut on an unsettled identity, so resuming delivery for
      // a signed-out visitor means asking again here.
      startVisitorIdentityResolution();
      flush();
    }

    function handlePageHide(): void {
      persistTrackedAnalyticsEvents();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("pagehide", handlePageHide);
    const intervalId = window.setInterval((): void => {
      // Covers the failures no `online` event follows — a 5xx, or a timeout on the cold-container
      // GeoLite download — without polling the route: the resolver's attempt cap and retry delay
      // decide whether this tick asks anything at all.
      startVisitorIdentityResolution();
      flush();
    }, periodicFlushIntervalMs);
    flush();

    return (): void => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("pagehide", handlePageHide);
      window.clearInterval(intervalId);
      if (persistTimerId !== null) {
        window.clearTimeout(persistTimerId);
        persistTimerId = null;
      }
      void persistPendingRecords();
      if (flushTimerId !== null) {
        window.clearTimeout(flushTimerId);
        flushTimerId = null;
        flushDueAtMs = null;
      }
    };
  }

  return {
    isAnalyticsEnabledForCurrentRuntime,
    enqueue,
    flush,
    reset,
    setEnabled,
    startAnalytics,
    setAnalyticsConfirmedOwner,
    readAnalyticsSessionOwnerId,
    registerAnalyticsSessionOwnerPublisher,
  };
}
