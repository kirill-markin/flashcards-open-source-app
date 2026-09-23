import {
  ApiError,
  getCachedSessionCsrfToken,
  sendAnalyticsEventsBatch,
  sendAnonymousAnalyticsEvent,
  submitAnalyticsVisitorConsent,
  type AnalyticsIngestResult,
} from "../api";
import { hasLoggedInCookie } from "../appData/session/activation/warmStart";
import { readStoredWebGuestSession, resetWebGuestSession } from "../appData/session/guest/webGuestSession";
import { isAuthenticatedAppPath } from "../routes";
import {
  isAwaitingAnalyticsConsentDecision,
  readAnalyticsConsentDecision,
  recordAnalyticsConsentDecision,
} from "./consent";
import type {
  AnalyticsDropReason,
  AnalyticsEvent,
  AnalyticsSurface,
  AnalyticsWireBatch,
  AnalyticsWireEvent,
  IdentityFreeAnalyticsEventName,
} from "./events";
import {
  clearAnalyticsVisitorCookie,
  dropLegacyAnalyticsAnonymousId,
  readAnalyticsAnonymousId,
  readAnalyticsSessionId,
  readAnalyticsVisitorId,
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
  isProductAnalyticsCollectionEnabled,
  recordProductAnalyticsCollectionDecision,
  subscribeToProductAnalyticsCollection,
} from "./productAnalyticsCollection";
import {
  appendAnalyticsEvents,
  claimAnalyticsQueueOwner,
  clearAnalyticsQueue,
  readAnalyticsQueueOwner,
  readOldestAnalyticsEvents,
  readStoredAnalyticsQueuePresence,
  removeAnalyticsEvents,
  type AnalyticsQueueRecord,
  type QueuedAnalyticsEvent,
} from "./queue";
import {
  hasResolvedAnalyticsVisitorIdentity,
  resolveAnalyticsVisitorIdentity,
  resolveAnalyticsVisitorIdentityAfterConsentGrant,
} from "./visitorIdentity";
import {
  buildAnalyticsWireContext,
  measureAnalyticsWireEventBytes,
  toAnalyticsTimestamp,
  toAnalyticsWireEvent,
  toAnonymousAnalyticsWireEvent,
  toIdentityFreeAnalyticsWireEvent,
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
 * How long a pressed control waits for the queue to drain before it destroys the credential behind
 * it. On expiry the sign-out or the deletion goes ahead and whatever did not leave is lost.
 *
 * Two seconds, and the same two seconds on iOS and Android, because the three clients have to count
 * the same way. Nothing that nobody pressed ever waits here, so this is a pure interaction budget
 * rather than a compromise with a background path: a person is looking at a spinner on the control
 * they just used, which is the range where a wait reads as work rather than as a hang. What has to
 * fit inside it is one round trip for one session's events — far below the fifty-event batch limit
 * — and a queue that needs longer than this is one that is offline or backed off, where no bound
 * short enough to put in front of a person would have delivered it either.
 */
const identityTeardownFlushTimeoutMs = 2 * 1000;
/**
 * Flush passes one identity teardown will start. A pass has to have delivered something and left
 * more queued to earn the next, so an ordinary backlog ends the loop on its own; the cap is only
 * there so a queue being appended to as fast as it drains cannot keep passing after the bound above
 * has already released the person.
 */
const identityTeardownFlushPassLimit = 10;
/**
 * Requests one flush may spend. A whole-batch refusal splits and retries, and an unbounded split of a
 * fully refused 50-event batch is ~99 back-to-back requests against a 20 rps endpoint throttle. The
 * budget must stay above the depth needed to isolate one event from a full batch — seven requests for
 * fifty events — or a split could stop before dropping anything and never converge.
 */
const flushRequestBudget = 12;
/**
 * How many events one load may hold in memory while this browser may write nothing to the device.
 * It bounds a tab left open on a banner nobody answers; what it drops is reported as a loss like any
 * other, on the first flush the browser is allowed.
 */
const heldEventLimit = 200;
/**
 * The shortest gap between two attempts at an owed mint. Nothing schedules that `POST` any more —
 * `startVisitorIdentityResolution` performs it whenever the browser owes one, so the load, every
 * `online` event and every periodic tick reattempt it by themselves — and this is the one thing a
 * ladder of timers was still doing that nothing else does: keeping a failing browser from asking a
 * route that can pay a GeoLite download once a minute for the life of the page. It matches the plain
 * resolution's own retry spacing, because it bounds the same route for the same reason.
 */
const deferredConsentMintRetryDelayMs = 5 * 60 * 1000;

function readInitialEnabled(): boolean {
  try {
    return readStoredAnalyticsEnabled();
  } catch {
    return true;
  }
}

/**
 * What one discard covers. Named rather than positional because the three answers differ per caller
 * and none of them follows from the others: a refusal keeps what it holds in memory and reports
 * nothing, an identity boundary takes everything and reports it, and the kill switch takes
 * everything silently.
 */
type QueuedWorkDiscardOptions = Readonly<{
  shouldReportDiscard: boolean;
  shouldReleaseOwner: boolean;
  shouldDiscardHeldEvents: boolean;
}>;

type AnalyticsDeliveryRuntime = Readonly<{
  isAnalyticsEnabledForCurrentRuntime: () => boolean;
  enqueue: (event: AnalyticsEvent, surface: AnalyticsSurface | null) => void;
  reportIdentityFreeEvent: (eventName: IdentityFreeAnalyticsEventName) => void;
  applyAnalyticsConsentGrant: () => Promise<boolean>;
  applyAnalyticsConsentDecline: () => Promise<void>;
  applyProductAnalyticsCollection: (isCollectionEnabled: boolean) => void;
  flush: () => void;
  flushBeforeIdentityTeardown: () => Promise<void>;
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
  /**
   * What this browser collected while it could write nothing to the device: before it knew whether
   * it had to ask for consent, while it was waiting for the answer, and for the rest of the load
   * when the answer was a refusal. They carry no session id, because obtaining one is itself a
   * write, and they leave on whichever transport the refusal allows.
   */
  let heldWireEvents: Array<AnalyticsWireEvent> = [];
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
  /**
   * The part of `retryNotBeforeMs` the server asked for with `Retry-After`. Only the identity
   * teardown reads it, to tell a delay the server set from one this client chose after a transport
   * failure or a 5xx.
   */
  let serverDirectedRetryNotBeforeMs = 0;
  let isFlushing = false;
  /**
   * The flush that is running now, or the last one that ran. `runFlush` returns immediately while
   * another is in flight, so this is the only handle an identity teardown can wait on.
   */
  let activeFlushTask: Promise<void> = Promise.resolve();
  /**
   * Whether the last flush stopped with events still queued — the batch limit was filled, or the
   * sent run stopped at a session boundary. It is the identity teardown's only way to tell a queue
   * that is empty from one that merely needs another pass.
   */
  let didLastFlushLeaveQueuedRemainder = false;
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
  /**
   * Whether this load has opened the analytics database at all. Opening it creates it, so a browser
   * that has never been allowed storage on this load has no store to discard — and a decline that
   * "emptied" one would create the very database the banner promised not to write
   * (docs/analytics-visitor-identity.md). Every path that reaches the store sets it: the append, the
   * owner claim, and the flush that reads.
   */
  let hasOpenedAnalyticsQueue = false;
  /**
   * An owner the session layer published while this browser could be written to nothing. The account
   * is held in memory either way, so the claim waits rather than being lost, and `runFlush` re-arms
   * it on the first flush this browser is allowed — without which a signed-in person who has just
   * granted would keep `isQueueOwnerReconciled` false and park their events until the next load.
   */
  let isQueueOwnerClaimDeferred = false;
  /**
   * A consent mint in flight, and the earliest a failed owed one may be attempted again. Both are
   * per document and neither is stored: whether a mint is owed at all is read from the stored
   * consent decision and the visitor cookie, so a load that ends mid-attempt owes exactly the same
   * thing to the next one. The in-flight flag is what keeps the callers that reattempt the mint —
   * the load, `online`, the periodic tick — from overlapping two `POST`s, which would mint two ids
   * and count one browser as two visitors.
   *
   * It covers the banner's own grant as well as the owed mint, and in both cases it stays raised
   * across the identity resolution that follows the `POST`: that resolution clears the settled flag
   * for the length of its `GET`, which is exactly the shape a tick landing inside it would read as
   * an owed mint and answer with a second, redundant `POST`.
   */
  let isConsentIdentityMintInFlight = false;
  let deferredConsentMintNotBeforeMs = 0;
  /**
   * The collection answer this runtime has already carried out. The person can move the switch in
   * another tab, where only that document runs `applyProductAnalyticsCollection`, so the shared
   * decision publishes the change to this one as well; this is what tells an answer that still has
   * to be carried out from the one already in force.
   */
  let lastCarriedOutCollection = isProductAnalyticsCollectionEnabled();

  function isAnalyticsEnabledForCurrentRuntime(): boolean {
    return isEnabled;
  }

  /**
   * Whether anything may be collected or sent at all: the operator kill switch and the person's own
   * product-analytics setting each close this, and nothing reopens it but the switch that closed it.
   *
   * It is deliberately not the consent banner's answer, which decides only whether what is reported
   * carries an identifier (`productAnalyticsCollection.ts`).
   */
  function isProductAnalyticsCollecting(): boolean {
    return isEnabled && isProductAnalyticsCollectionEnabled();
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

  /**
   * Keeps one event in memory, for a browser nothing analytics collects may be written to. The
   * session id is deliberately not read here: `readAnalyticsSessionId` persists the session it
   * returns, so asking for one would be the write this path exists to avoid.
   */
  function holdEvent(event: AnalyticsEvent, surface: AnalyticsSurface | null): void {
    const wireEvent = toAnalyticsWireEvent(event, Date.now(), surface);
    if (measureAnalyticsWireEventBytes(wireEvent) > analyticsEventByteLimit) {
      countDropped("rejected", 1);
      return;
    }

    if (heldWireEvents.length >= heldEventLimit) {
      countDropped("queue_overflow", 1);
      return;
    }

    heldWireEvents.push(wireEvent);
  }

  /**
   * Whether anything analytics collects may be written to this device right now.
   *
   * A browser that has not answered the banner it is being shown, or that does not yet know whether
   * it has to be asked at all, may store nothing. Neither may one that refused, and holding an
   * account credential does not change that: the refusal is about this device, so a signed-in
   * person's events are reported under their own credential straight out of memory
   * (`deliverHeldEventsUnderAccount`) rather than queued on a device that said no.
   */
  function isAnalyticsDeviceStorageAllowed(): boolean {
    return isAwaitingAnalyticsConsentDecision() === false
      && readAnalyticsConsentDecision() !== "declined";
  }

  /** The one routing decision every collected event takes, from `track` and from drop reporting. */
  function collectEvent(event: AnalyticsEvent, surface: AnalyticsSurface | null): void {
    if (isAnalyticsDeviceStorageAllowed()) {
      enqueueEvent(event, surface);
      return;
    }

    holdEvent(event, surface);
  }

  /**
   * Moves what was held in memory into the queue, for a browser that may write to this device
   * again — which is the load that granted, and nothing else. What was held while a refusal stood
   * never arrives here: `applyAnalyticsConsentGrant` discards it first, because consent is not
   * retroactive and adopting it would stamp it with the id that grant has just minted. One session
   * id is read for all of them: they were all collected inside this document, so they belong to the
   * session it is in when it is finally allowed to have one.
   */
  function adoptHeldEvents(): void {
    if (heldWireEvents.length === 0) {
      return;
    }

    const adoptedWireEvents = heldWireEvents;
    heldWireEvents = [];
    const sessionId = readAnalyticsSessionId(Date.now());
    for (const wireEvent of adoptedWireEvents) {
      pendingRecords.push({
        eventId: wireEvent.eventId,
        sessionId,
        createdAtMs: Date.parse(wireEvent.clientOccurredAt),
        byteSize: measureAnalyticsWireEventBytes(wireEvent),
        wireEvent,
      });
    }
  }

  function persistPendingRecords(): Promise<void> {
    persistTask = persistTask.then(async (): Promise<void> => {
      if (pendingRecords.length === 0) {
        return;
      }

      const records = pendingRecords;
      pendingRecords = [];
      hasOpenedAnalyticsQueue = true;
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
        // Tracked like every other flush, so an identity teardown waits for a scheduled drain
        // rather than starting a second one beside it.
        startTrackedFlush();
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
      collectEvent({ name: "analytics_events_dropped", reason, count }, readCurrentSurface());
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

  /**
   * The session id is a parameter rather than a read, because the one batch shape serves two
   * sources: the queue, whose records carry the session they were created in, and the held events of
   * a browser that refused, which carry none — obtaining a session id is itself a write to the
   * device, and the envelope accepts a null.
   */
  function buildWireBatch(
    wireEvents: ReadonlyArray<AnalyticsWireEvent>,
    sessionId: string | null,
  ): AnalyticsWireBatch {
    return {
      // Stamped at request time, not at event time: the server derives every stored `occurred_at` from
      // the interval between this and each event's `clientOccurredAt`.
      clientSentAt: toAnalyticsTimestamp(Date.now()),
      anonymousId: readAnalyticsAnonymousId(),
      sessionId,
      context: buildAnalyticsWireContext(),
      events: wireEvents,
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
  function isDropOnlyBatch(wireEvents: ReadonlyArray<AnalyticsWireEvent>): boolean {
    return wireEvents.every((wireEvent) => wireEvent.eventName === "analytics_events_dropped");
  }

  function toWireEvents(events: ReadonlyArray<QueuedAnalyticsEvent>): ReadonlyArray<AnalyticsWireEvent> {
    return events.map((event) => event.wireEvent);
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
        if (isDropOnlyBatch(toWireEvents(events)) === false) {
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
    armDeliveryBackoff(error, statusCode);
  }

  /**
   * Holds delivery off after a failure that is not a permanent refusal, and schedules the retry the
   * events are waiting for. Shared by both transports so one of them cannot drift into retrying at a
   * rate the other does not.
   */
  function armDeliveryBackoff(error: unknown, statusCode: number): void {
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
    serverDirectedRetryNotBeforeMs = retryAfterMs === null ? 0 : retryNotBeforeMs;
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
    return hasAccountCredentialOnThisLoad();
  }

  /**
   * Whether an account credential exists on this browser, or can still arrive on this page load.
   * None of the four facts is stable within a document, so every caller reads it live.
   */
  function hasAccountCredentialOnThisLoad(): boolean {
    return confirmedOwnerId !== null
      || sessionOwnerPublisherCount !== 0
      || hasLoggedInCookie()
      || getCachedSessionCsrfToken() !== null;
  }

  /**
   * Whether a confirmed account owner can still arrive on this load, which is what an authenticated
   * send waits for. The publisher lives in the app data provider, and only `AuthenticatedApp` mounts
   * it: on the public routes rendered above it — the catalog import, the friend invite, the share
   * page — a browser carrying `logged_in` never gets one, so waiting there is waiting forever.
   *
   * Read live from the address bar rather than latched, because a client-side navigation reaches the
   * authenticated routes without a reload, and a publisher that has mounted answers for itself.
   */
  function canPublishSessionOwnerOnThisRoute(): boolean {
    return confirmedOwnerId !== null
      || sessionOwnerPublisherCount !== 0
      || isAuthenticatedAppPath(window.location.pathname);
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
   * `AppDataProvider` under a root `AppErrorBoundary`, either the one in `App.tsx` or the one
   * `main.tsx` mounts above `I18nProvider`.
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
        // again. The one drop that would strand an owner here forever retires it itself instead: a
        // refusal releases the owner its envelope named in the same pass that drops the envelope
        // (`applyAnalyticsConsentDecline`), because this comparison could never match afterwards.
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
      result = await sendAnalyticsEventsBatch(buildWireBatch(toWireEvents(events), events[0].sessionId));
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
    if (isDropOnlyBatch(toWireEvents(events)) === false) {
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

  /**
   * Whether what this browser is holding may go out with no identity on it. That is the refusal's
   * own reading: the person said no to being identified, not to the product knowing a page was
   * opened, so the rows keep the surface, the locale and their date and carry nothing that names a
   * visitor (docs/anonymous-client-analytics.md).
   *
   * An account credential closes this path rather than widening it, while one can still be used. A
   * signed-in person's events are the account's, reported under their `user_id` on the authenticated
   * ingest, and an actor whose `app_opened` rows all came from the collector reads as an actor with
   * no `app_opened` at all. Where no credential can ever become sendable — a browser carrying
   * `logged_in` on a route the session layer never mounts on — the choice is not between the two
   * transports but between the collector and losing the events with the document, because a refused
   * browser holds them in memory and has no queue to leave them in. The collector wins that: the
   * person refused being identified, which is exactly what an identity-free row is.
   *
   * "Can ever become sendable" is true of those routes only because every link out of the public
   * screens is a full-document `<a href>`, so no client-side navigation reaches `AuthenticatedApp`
   * within one document. Add a react-router `<Link>` from `/share`, `/invite/:token` or
   * `/catalog/import/:id` into the app and that stops holding: a flush taken on the public route
   * spends a signed-in refused person's `app_opened` on the collector irreversibly, where waiting a
   * moment would have shipped it under their account. Either keep those links full-document, or
   * narrow this branch before adding one.
   */
  function canDeliverHeldEventsWithoutIdentity(): boolean {
    if (readAnalyticsConsentDecision() !== "declined") {
      return false;
    }

    return hasAccountCredentialOnThisLoad() === false || canPublishSessionOwnerOnThisRoute() === false;
  }

  /**
   * Ships the held events one request at a time, with no identifier and without ever storing them.
   * A permanently refused event is dropped here instead of being isolated by a batch split: one
   * request already carries one event, and there is no queue behind it to split.
   */
  async function deliverHeldEventsWithoutIdentity(flushGeneration: number): Promise<void> {
    while (heldWireEvents.length > 0) {
      // The same three preconditions every request in `deliverBatch` rechecks, for the same reasons.
      if (flushGeneration !== analyticsGeneration || Date.now() < retryNotBeforeMs) {
        return;
      }

      if (remainingFlushRequestCount <= 0) {
        scheduleFlush(0);
        return;
      }

      const wireEvent = heldWireEvents[0];
      remainingFlushRequestCount -= 1;
      try {
        await sendAnonymousAnalyticsEvent(toAnonymousAnalyticsWireEvent(wireEvent, Date.now()));
      } catch (error) {
        if (flushGeneration !== analyticsGeneration) {
          return;
        }

        const statusCode = error instanceof ApiError ? error.statusCode : 0;
        if (statusCode !== 400 && statusCode !== 413) {
          armDeliveryBackoff(error, statusCode);
          return;
        }

        // Resending the same bytes fails identically forever.
        reportAnalyticsInvalidBatch(statusCode);
        heldWireEvents = heldWireEvents.slice(1);
        // A refused drop event must not regenerate itself, exactly as on the queued transports.
        if (wireEvent.eventName !== "analytics_events_dropped") {
          countDropped("rejected", 1);
        }

        continue;
      }

      consecutiveFailureCount = 0;
      firstDeliveryFailureAtMs = null;
      lastFailureStatusCode = null;
      retryNotBeforeMs = 0;
      if (flushGeneration !== analyticsGeneration) {
        return;
      }

      heldWireEvents = heldWireEvents.slice(1);
    }
  }

  /** Releases the held events a request has settled, delivered or refused for good. */
  function releaseHeldEvents(wireEvents: ReadonlyArray<AnalyticsWireEvent>): void {
    const settledEventIds = new Set(wireEvents.map((wireEvent) => wireEvent.eventId));
    heldWireEvents = heldWireEvents.filter(
      (wireEvent) => settledEventIds.has(wireEvent.eventId) === false,
    );
  }

  /**
   * Ships one batch of held events on the account's own credential, and nothing else: no
   * `anonymousId`, because `readAnalyticsAnonymousId` gives a refused browser none, and no session
   * id, because obtaining one is a write to a device that said no. What the rows keep is the
   * `user_id` the credential gives them, which is the account's own measurement rather than the
   * browser's — and it is what keeps a signed-in person from reading as an actor with no
   * `app_opened` at all (apps/backend/src/productAnalytics/syntheticActorDetector.ts).
   *
   * A permanently refused batch is split until the single event that caused it is isolated and
   * dropped, the same rule `deliverBatch` applies to the queue, with the held array standing in for
   * it. Returns whether the batch was settled; a transient failure leaves everything held for the
   * retry the backoff schedules.
   */
  async function deliverHeldBatchUnderAccount(
    wireEvents: ReadonlyArray<AnalyticsWireEvent>,
    flushGeneration: number,
  ): Promise<boolean> {
    // Rechecked here rather than only by the caller, exactly as `deliverBatch` does it: the second
    // half of a split is posted after the first half's request resolved, and a
    // `setAnalyticsConfirmedOwner` or a `reset()` that landed during that await would otherwise put
    // the previous identity's events on the next one's credential.
    if (flushGeneration !== analyticsGeneration) {
      return false;
    }

    if (remainingFlushRequestCount <= 0) {
      scheduleFlush(0);
      return false;
    }

    remainingFlushRequestCount -= 1;
    let result: AnalyticsIngestResult;
    try {
      result = await sendAnalyticsEventsBatch(buildWireBatch(wireEvents, null));
    } catch (error) {
      if (flushGeneration !== analyticsGeneration) {
        return false;
      }

      const statusCode = error instanceof ApiError ? error.statusCode : 0;
      if (statusCode !== 400 && statusCode !== 413) {
        armDeliveryBackoff(error, statusCode);
        return false;
      }

      // Resending the same bytes fails identically forever.
      reportAnalyticsInvalidBatch(statusCode);
      if (wireEvents.length === 1) {
        releaseHeldEvents(wireEvents);
        // A refused drop event must not regenerate itself, exactly as on the queued transports.
        if (isDropOnlyBatch(wireEvents) === false) {
          countDropped("rejected", 1);
        }

        return true;
      }

      const midpoint = Math.ceil(wireEvents.length / 2);
      const wasFirstHalfSettled = await deliverHeldBatchUnderAccount(
        wireEvents.slice(0, midpoint),
        flushGeneration,
      );
      if (wasFirstHalfSettled === false) {
        return false;
      }

      return await deliverHeldBatchUnderAccount(wireEvents.slice(midpoint), flushGeneration);
    }

    consecutiveFailureCount = 0;
    firstDeliveryFailureAtMs = null;
    lastFailureStatusCode = null;
    retryNotBeforeMs = 0;
    if (flushGeneration !== analyticsGeneration) {
      return false;
    }

    releaseHeldEvents(wireEvents);
    if (isDropOnlyBatch(wireEvents) === false) {
      countDropped("rejected", result.rejectedCount);
    }

    return true;
  }

  /**
   * Drains what a signed-in browser that refused consent is holding, batch by batch. It waits rather
   * than falling back to the collector when the credential is not sendable yet: those events are the
   * account's, and reporting them identity-free would file a signed-in person's activity as a
   * visitor's. The wait is bounded by the route — where no owner can be published at all,
   * `canDeliverHeldEventsWithoutIdentity` routes them to the collector instead of here.
   */
  async function deliverHeldEventsUnderAccount(flushGeneration: number): Promise<void> {
    while (heldWireEvents.length > 0) {
      // The same preconditions every request in `deliverBatch` rechecks, for the same reasons.
      if (flushGeneration !== analyticsGeneration || Date.now() < retryNotBeforeMs) {
        return;
      }

      if (hasSendableSessionCredential() === false) {
        return;
      }

      const wasSettled = await deliverHeldBatchUnderAccount(
        heldWireEvents.slice(0, batchEventLimit),
        flushGeneration,
      );
      if (wasSettled === false) {
        return;
      }
    }
  }

  /**
   * Reports one of the two consent facts the catalog allows no identity at all. It goes out on its
   * own, immediately, and is never queued: the browser it describes may have nothing written to it,
   * and every queued event is stamped with an `anonymousId` the collector refuses on these names.
   *
   * A failed send loses the event. There is nowhere to keep it that the person has agreed to, and
   * nothing analytics does may surface to the user or block the banner they are answering.
   */
  function reportIdentityFreeEvent(eventName: IdentityFreeAnalyticsEventName): void {
    // Identity-free or not, this is a product-analytics event and it is sent rather than queued, so
    // a browser that is not collecting reports nothing here either.
    if (isProductAnalyticsCollecting() === false) {
      return;
    }

    void sendAnonymousAnalyticsEvent(toIdentityFreeAnalyticsWireEvent(eventName, Date.now()))
      .catch((): void => undefined);
  }

  /**
   * Records a consent grant for this browser and releases everything that was waiting on it.
   *
   * The grant succeeded exactly when the answer carries a `visitorId`; the `consentRequired` field
   * reports the jurisdiction on this method and says nothing about whether this browser still has to
   * be asked (docs/analytics-visitor-identity.md). Nothing is recorded locally unless the server
   * recorded it, so a failed call leaves the banner up rather than silently swallowing the answer.
   *
   * It reports no event of its own: the surface the person answered on reports the decision, so a
   * decision carried over from an account does not look like one somebody just made.
   */
  async function applyAnalyticsConsentGrant(): Promise<boolean> {
    // The kill switch outranks a grant, and this is the one call that would mint a 13-month cookie
    // for a browser nothing is ever tracked from. Refusing it is also what keeps the withdrawal
    // switch honest: it reads the stored decision, so a grant stored under a switched-off runtime
    // would render "on" over a runtime that reports nothing. The refusal is deliberately not
    // symmetric —
    // `applyAnalyticsConsentDecline` runs either way, because a withdrawal must never be blocked.
    if (isEnabled === false) {
      return false;
    }

    // The person's own collection switch outranks it too, and on the same asymmetry — but it refuses
    // only the mint. Their cookie answer did not fail and is not being declined, so it is recorded
    // here and carried to the account by the caller exactly as any other grant is; what waits is the
    // identifier, which has nothing to attribute while collection is off. Turning collection back on
    // performs the mint this defers.
    if (isProductAnalyticsCollectionEnabled() === false) {
      recordAnalyticsConsentDecision("granted");
      return true;
    }

    // The banner's grant is a consent mint like the owed one, and it is raised across the resolution
    // that follows: between recording `granted` and that resolution settling, this browser reads as
    // owing a mint, and a periodic tick landing there would answer it with a second `POST`.
    isConsentIdentityMintInFlight = true;
    try {
      const visitor = await submitAnalyticsVisitorConsent(true);
      if (visitor.visitorId === null) {
        return false;
      }

      // Consent is not retroactive. Whatever was collected while a refusal stood was collected under
      // an answer that said this person was not to be measured, so the grant releases what follows
      // it and nothing before it. Not reported as a loss, for the same reason the refusal's own
      // discard is not: it is the recorded answer taking effect, not something anybody needs to be
      // told about.
      if (readAnalyticsConsentDecision() === "declined") {
        heldWireEvents = [];
      }

      recordAnalyticsConsentDecision("granted");
      await resolveAnalyticsVisitorIdentityAfterConsentGrant();
    } finally {
      isConsentIdentityMintInFlight = false;
    }

    flush();
    return true;
  }

  /**
   * Whether this browser was ever allowed an analytics identity, and so may be holding a stored
   * queue from this load or an earlier one. Read at the top of a refusal, before the server's answer
   * clears the visitor cookie and before the refusal records itself over the stored answer: both are
   * the evidence.
   */
  function wasAllowedAnalyticsIdentity(): boolean {
    return readAnalyticsConsentDecision() === "granted" || readAnalyticsVisitorId() !== null;
  }

  /**
   * Opens the stored queue for the discard a refusal is about to perform, and answers whether that
   * discard may retire the queue's owner with it.
   *
   * Opening is what creates the store, so a browser that answered `Decline` before anything was ever
   * written to it is never opened here: it has to end the load with no analytics store at all, which
   * is what the strip promised it. A browser that was already allowed an identity has no such
   * promise to keep, so where the engine cannot say whether a store exists — Firefox enumerates no
   * databases — the refusal opens it rather than leaving a previous load's identity-bearing queue on
   * disk. Emptying that queue is precisely what the person has just asked for, and an empty database
   * created on a browser that never filled one is the smaller of the two costs.
   *
   * The owner is retired only where the guest envelope this refusal just dropped is the one naming
   * it. That is the only owner this refusal may retire, and this is the only chance it gets:
   * `releaseUnconfirmableQueueOwner` recognizes a retired owner by the stored envelope alone, so an
   * owner whose envelope is gone can never be released again, and everything a later grant queues
   * sits under it until the TTL takes it. A guest owner whose envelope was already gone when this
   * ran is therefore not covered either — nothing left on this browser can name it — and that is an
   * accepted cost rather than something this handles. Any other owner is left in place on purpose: a
   * signed-in person's queue is owned by their account, which they can still confirm on the next
   * load, and deleting that record would park a later grant's events behind an owner comparison that
   * can never match either.
   */
  async function openStoredQueueForRefusal(
    droppedGuestOwnerId: string | null,
    wasIdentityAllowed: boolean,
  ): Promise<boolean> {
    try {
      const storedQueuePresence = await readStoredAnalyticsQueuePresence();
      if (storedQueuePresence === "absent") {
        return false;
      }

      if (storedQueuePresence === "unknown" && wasIdentityAllowed === false) {
        return false;
      }

      // Everything past this line reaches the store, the discard this returns to included: what it
      // holds was collected under the consent being withdrawn.
      hasOpenedAnalyticsQueue = true;
      if (droppedGuestOwnerId === null) {
        return false;
      }

      return (await readAnalyticsQueueOwner()) === droppedGuestOwnerId;
    } catch (error) {
      reportAnalyticsQueueFailure(error);
      return false;
    }
  }

  /**
   * Records a refusal for this browser. The server clears any visitor cookie it carries and mints
   * nothing; what this adds is local: the stored decision, which is what stops this browser asking
   * for an identity again, the retirement of every analytics identifier still on the device — the
   * queue's own guest owner among them, where the envelope this drops is what named it — and the
   * discard of everything collected under the consent being withdrawn. The events held in memory
   * stay held — they carry no identity, which is the one thing the refusal is about, and they go out
   * on the next flush.
   */
  async function applyAnalyticsConsentDecline(): Promise<void> {
    // Read first: the call below clears the visitor cookie and the line after it records the
    // refusal over the stored answer, and those two are what say this browser once held an identity
    // and may be holding a queue to match.
    const wasIdentityAllowed = wasAllowedAnalyticsIdentity();
    await submitAnalyticsVisitorConsent(false);
    recordAnalyticsConsentDecision("declined");
    // The server's own answer clears the cookie; this closes the window after it, where a `GET` that
    // was already in flight lands its own `Set-Cookie` on a browser that has just refused.
    clearAnalyticsVisitorCookie();
    // The cookie is not the only identifier a browser upgrading from an earlier build carries. The
    // stored `anonymous_id` is otherwise retired only by the visitor identity resolution, which a
    // refusal never runs again, and the guest envelope is otherwise kept for a link the refusal has
    // just made impermissible. Both would sit in `localStorage` indefinitely after a refusal.
    dropLegacyAnalyticsAnonymousId();
    // Read before the drop, because afterwards nothing on this browser can say who the queue's
    // guest owner was: the envelope is the only record of it.
    const droppedGuestOwnerId = readStoredWebGuestSession()?.userId ?? null;
    resetWebGuestSession();
    // Not reported as a loss: discarding what was collected before a refusal is the refusal's
    // documented effect rather than something anybody needs to be told about. Whether it may reach
    // the store at all is decided above, on this browser's own history rather than on this load's.
    // What is held in memory is deliberately kept: it carries no identity, which is the one thing
    // the refusal is about. The owner goes with the queue only when the envelope just dropped is
    // the one naming it.
    discardQueuedWork({
      shouldReportDiscard: false,
      shouldReleaseOwner: await openStoredQueueForRefusal(
        droppedGuestOwnerId,
        wasIdentityAllowed,
      ),
      shouldDiscardHeldEvents: false,
    });
    resetAnalyticsSession();
    flush();
  }

  async function runFlush(): Promise<void> {
    // Cleared before every exit, so no path that sends nothing can leave a stale `true` behind: the
    // identity teardown's loop reads it to decide whether another pass is worth starting, and would
    // otherwise spend all of them on flushes that cannot progress. It sits above the guard rather
    // than below it for that reason — a browser that is not collecting returns on the very next
    // line, and that is one of the paths that must not leave a remainder claimed.
    didLastFlushLeaveQueuedRemainder = false;

    if (isProductAnalyticsCollecting() === false || isFlushing) {
      return;
    }

    // Nothing this browser collected may leave it while the consent question is open: it has not
    // been asked yet where it has to be, or it does not know yet whether it has to be. What was
    // tracked meanwhile is held in memory and goes out on the flush the answer releases.
    if (isAwaitingAnalyticsConsentDecision()) {
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
      // A browser that refused consent never reaches the queue at all: its rows go straight out of
      // memory, so neither queued transport below has anything to read and the stored queue is left
      // exactly as the refusal discarded it. Which transport carries them is the only thing an
      // account credential decides — the account's own ingest, or the identity-free collector.
      if (readAnalyticsConsentDecision() === "declined") {
        remainingFlushRequestCount = flushRequestBudget;
        drainDropReports();
        if (canDeliverHeldEventsWithoutIdentity()) {
          await deliverHeldEventsWithoutIdentity(analyticsGeneration);
        } else {
          await deliverHeldEventsUnderAccount(analyticsGeneration);
        }

        return;
      }

      // Past this line this browser may be written to, so a claim the session layer published while
      // it could not be is run now. Without it `isQueueOwnerReconciled` would stay false for the
      // rest of the load and park a signed-in person's events until the next one.
      claimDeferredQueueOwner();
      hasOpenedAnalyticsQueue = true;
      // Everything held while this browser could write nothing to itself belongs in the queue now.
      adoptHeldEvents();

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
      didLastFlushLeaveQueuedRemainder = hasDeliveredInFlush && hasQueuedRemainder;
      if (didLastFlushLeaveQueuedRemainder) {
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
    // The claim writes the owner record, and writing it is what creates the analytics database. It
    // is therefore storage like any other and takes both gates that decide whether this browser may
    // be written to at all: a signed-in visitor looking at an unanswered banner, and one who refused,
    // must not be given an analytics store they never agreed to — and neither may a person whose
    // collection switch is off, for whom nothing is sent, queued, held or stored. The collection gate
    // is not implied by the consent one: a browser that answered `Grant` and then turned collection
    // off passes the storage question and must still write nothing, and the session layer publishes
    // an owner on every verified session, so without this every signed-in page load would create the
    // database and record the account in it. Nothing is lost by waiting — the account is held in
    // memory — so the claim is deferred, and `claimDeferredQueueOwner` runs it from the first flush
    // this browser is allowed, which the off→on transition performs itself.
    if (isProductAnalyticsCollecting() === false || isAnalyticsDeviceStorageAllowed() === false) {
      isQueueOwnerClaimDeferred = true;
      return;
    }

    isQueueOwnerClaimDeferred = false;
    // Chained onto the persist task like every other queue operation, so a claim can neither interleave
    // with a write nor leave the chain rejected for the writes behind it.
    persistTask = persistTask.then(async (): Promise<void> => {
      hasOpenedAnalyticsQueue = true;
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
   * Runs a claim that was deferred because this browser could be written to nothing at the time —
   * the consent question was open or refused, or collection was off. Called from the flush, which is
   * the first thing that happens once an answer allows storage — the grant flushes, and so does every
   * periodic tick — and directly from the collection switch going back on, because that transition's
   * own flush can find one already in flight and return without re-arming anything.
   */
  function claimDeferredQueueOwner(): void {
    if (isQueueOwnerClaimDeferred === false || confirmedOwnerId === null) {
      return;
    }

    claimQueueOwner(confirmedOwnerId);
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
    if (isProductAnalyticsCollecting() === false) {
      return;
    }

    collectEvent(event, surface);
    trackedSinceFlushCount += 1;
    // A held event persists nothing, because `pendingRecords` is empty; the flush the threshold
    // schedules is what a browser reporting without an identity drains its held events on.
    schedulePersist();
  }

  /**
   * Starts a flush and keeps a handle on it.
   *
   * A call made while one is already running is dropped by `runFlush` itself and comes back as an
   * immediately resolved promise; storing that would hide the flush that is actually running from
   * the identity teardown waiting on it, and the teardown would return having drained nothing.
   */
  function startTrackedFlush(): void {
    if (isFlushing) {
      return;
    }

    activeFlushTask = runFlush();
  }

  function flush(): void {
    startTrackedFlush();
  }

  /**
   * Drains the queue while the credential that would carry it still exists, bounded because a
   * person is waiting behind it.
   *
   * On this client the identity boundary is split across a navigation: `reset()` runs on the load
   * *after* the sign-out, the deletion or the account switch, by which point the credential is
   * gone and a flush there would either post nothing or post the previous account's events on
   * whoever is signed in now. So this is called from the control that is about to destroy the
   * credential, never from `reset()`.
   *
   * The in-flight flush is awaited first: it read the queue before the event this teardown is
   * waiting on was appended, so only the flush started after it can carry that event. Then passes
   * run until one leaves nothing queued, because a single flush sends at most one session run and
   * at most `batchEventLimit` events: an older session's backlog would otherwise sit in front of
   * the event this exists to deliver, and the follow-up `scheduleFlush(0)` is a timer the sign-out
   * navigation destroys. Every await carries its own catch, so a stale rejected flush cannot abort
   * the chain and reduce the whole drain to nothing.
   *
   * No flush is cancelled on expiry — a request already sent has left the browser, and abandoning
   * it would lose more than waiting longer would save.
   */
  async function flushBeforeIdentityTeardown(): Promise<void> {
    // A browser that is not collecting has nothing to drain and no way to send it: `enqueue` never
    // wrote the event this drain exists for, and every pass below would reach a `runFlush` that
    // returns on this same call before it reads the queue. Returning here rather than letting the passes
    // discover it is what keeps the wait off a person who opted out — `settledFlushTask` below can
    // otherwise hold a pressed control while a delivery started before the switch was moved
    // finishes, which is a wait spent entirely on analytics by somebody who asked for none. iOS and
    // Android refuse the same wait at the entry to their own drains, on their own copy of this flag.
    if (isProductAnalyticsCollecting() === false) {
      return;
    }

    const drain = (async (): Promise<void> => {
      try {
        await runDrainPasses();
      } catch (error) {
        // The action the person pressed is a sign-out or an account deletion. Neither may fail, or
        // even look like it failed, because analytics could not empty a queue.
        reportAnalyticsQueueFailure(error);
      }
    })();

    let deadlineTimerId = 0;
    const deadline = new Promise<void>((resolve): void => {
      deadlineTimerId = window.setTimeout(resolve, identityTeardownFlushTimeoutMs);
    });

    await Promise.race([drain, deadline]);
    // The sign-out navigates away and takes the timer with it, but the account deletion stays on
    // the page, and a timer nothing is waiting on any more has no reason to be alive.
    window.clearTimeout(deadlineTimerId);
  }

  async function runDrainPasses(): Promise<void> {
    await settledFlushTask();
    persistTrackedAnalyticsEvents();
    // A delay this client chose itself is not this drain's to inherit. After a transient 5xx or an
    // offline stretch it reaches the one-hour cap, and the passes below would then all return at
    // the guard in `runFlush` with perfect connectivity — at the one moment these events can never
    // be retried. A `Retry-After` the server sent is kept: that one is not ours to ignore. Cleared
    // after the in-flight flush has settled, so a failure inside it cannot re-park the first pass.
    if (Date.now() < retryNotBeforeMs && Date.now() >= serverDirectedRetryNotBeforeMs) {
      retryNotBeforeMs = 0;
    }
    for (let pass = 0; pass < identityTeardownFlushPassLimit; pass += 1) {
      startTrackedFlush();
      await settledFlushTask();
      if (didLastFlushLeaveQueuedRemainder === false) {
        return;
      }
    }
  }

  /**
   * The current flush as something a waiter can always await. A failure inside analytics never
   * fails the action the person asked for, and `runFlush` reports what it can itself.
   */
  function settledFlushTask(): Promise<void> {
    return activeFlushTask.catch((): void => {});
  }

  /**
   * Asks for the shared visitor identity and flushes once it has settled: reporting with no
   * credential waits for that, so this is what releases a signed-out browser's first page view. It
   * is also the only path that performs a mint owed to a grant, which is why every caller that
   * reattempts the identity reattempts that too. One answer is asked for once;
   * `resolveAnalyticsVisitorIdentity` re-asks only after a call that threw and only under its own
   * bounds, and an owed mint has a minimum spacing of its own, so calling this on every connectivity
   * change and every periodic tick costs nothing once the identity has settled or the browser holds
   * one. Never awaited and never on a render path,
   * because a first visit can pay a GeoLite download inside the request. The kill switch, the
   * product-analytics setting and a refused banner are all explicit opt-outs and this call can set a
   * 13-month cookie, so none of those browsers asks for anything.
   */
  function startVisitorIdentityResolution(): void {
    if (isEnabled === false) {
      return;
    }

    // The shared identifier exists only to attribute product-analytics rows, and the switch has just
    // guaranteed there will be none. Keeping a cookie this browser already carries is a separate
    // question; minting a new one — which the route does unasked for every country that requires no
    // consent — is not defensible once collection is off.
    if (isProductAnalyticsCollectionEnabled() === false) {
      return;
    }

    // A browser that refused is never asked again. The route mints for any country that requires no
    // consent, so one more `GET` would hand back the identity the refusal had just cleared.
    if (readAnalyticsConsentDecision() === "declined") {
      return;
    }

    // A browser that granted and carries no identity is owed the `POST`, not this `GET` — and it is
    // owed it for as long as it owes it, whether or not this particular call may attempt one. Where
    // consent is required the `GET` withholds an identity from a browser the server holds no consent
    // record for, and then settles anyway on the stored `granted`, which permanently satisfies the
    // mint's own gate: one such `GET` ends the owed mint for the rest of the load and degrades a
    // granting browser to the per-tab id. So the owed state alone returns here, and the attempt
    // below is what the in-flight flag and the retry spacing bound. Suppressing the `GET` costs this
    // browser nothing else: a stored decision already answers `isAwaitingAnalyticsConsentDecision`,
    // so only the credential-free delivery waits, which is what owing a mint means.
    if (isDeferredAnalyticsConsentMintOwed()) {
      attemptDeferredAnalyticsConsentMint();
      return;
    }

    void resolveAnalyticsVisitorIdentity().then((): void => {
      flush();
    });
  }

  /** Drops the coalescing timer, so nothing it was holding is written after this point. */
  function cancelScheduledPersist(): void {
    if (persistTimerId !== null) {
      window.clearTimeout(persistTimerId);
      persistTimerId = null;
    }
  }

  /**
   * Starts the IndexedDB write for everything tracked so far instead of waiting for the coalescing
   * timer. The page-hide paths run it right after the collectors have emitted their closing events: the
   * `setTimeout` that normally batches the write never gets a chance to run once the page is going away.
   */
  function persistTrackedAnalyticsEvents(): void {
    try {
      cancelScheduledPersist();
      // The same gate every other write to the store passes. Nothing collected by a browser that is
      // no longer collecting may reach the disk on the way out, rather than only where the discard
      // happens to have emptied what this would have written.
      if (isProductAnalyticsCollecting() === false) {
        return;
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

  function discardQueuedWork(options: QueuedWorkDiscardOptions): void {
    const { shouldReportDiscard, shouldReleaseOwner, shouldDiscardHeldEvents } = options;
    // Invalidates any flush already in flight before a single record is touched, so it can neither
    // send the discarded events under the next identity nor delete records belonging to it.
    analyticsGeneration += 1;
    // Counted before the queue is emptied: an unreported drop is itself a silent loss.
    const unreportedLossCount = pendingRecords.length
      + sumPendingDropCounts()
      + (shouldDiscardHeldEvents ? heldWireEvents.length : 0);
    pendingRecords = [];
    if (shouldDiscardHeldEvents) {
      heldWireEvents = [];
    }

    pendingDropCounts = new Map<AnalyticsDropReason, number>();
    consecutiveFailureCount = 0;
    firstDeliveryFailureAtMs = null;
    lastFailureStatusCode = null;
    retryNotBeforeMs = 0;
    // Nothing on this load ever opened the analytics database, so there is nothing stored to
    // discard — and `clearAnalyticsQueue` would open it, which creates it. On the refusal path that
    // is precisely the write the banner promised not to make: a browser that answered `Decline`
    // before anything was allowed to touch it must end the load with no analytics store at all.
    if (hasOpenedAnalyticsQueue === false) {
      if (shouldReportDiscard && unreportedLossCount > 0) {
        reportAnalyticsQueueDiscardedOnReset(unreportedLossCount);
      }

      return;
    }

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
      isQueueOwnerClaimDeferred = false;
      // Including what is only held in memory: on a browser that refused consent that is everything
      // this document collected, and leaving it behind would post the previous account's events on
      // the next one's credential — the crossing this whole path exists to prevent.
      discardQueuedWork({
        shouldReportDiscard: true,
        shouldReleaseOwner: true,
        shouldDiscardHeldEvents: true,
      });
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
        // analytics back on does not have to wait for another verification to publish one. What is
        // held in memory goes with it: analytics being off means nothing collected under it ships.
        discardQueuedWork({
          shouldReportDiscard: false,
          shouldReleaseOwner: false,
          shouldDiscardHeldEvents: true,
        });
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

  /**
   * Empties a stored queue this load never opened, once the switch has gone off. `discardQueuedWork`
   * returns before the clear while `hasOpenedAnalyticsQueue` is false, and a load that never reached
   * the store — the flush gate returns on the switch itself, and on an unanswered consent question
   * before that — would otherwise end with an earlier load's events still on disk, which is exactly
   * what turning collection off promises to take.
   *
   * The presence probe creates nothing, so a browser with no analytics database still ends the load
   * with none. Where the engine enumerates no databases, the same trade as the refusal path is made:
   * a browser that was allowed an identity opens the store rather than keeping its events, and one
   * that never was keeps the promise that nothing is written to it.
   */
  function clearStoredQueueAfterCollectionOff(): void {
    const wasIdentityAllowed = wasAllowedAnalyticsIdentity();
    persistTask = persistTask.then(async (): Promise<void> => {
      try {
        const storedQueuePresence = await readStoredAnalyticsQueuePresence();
        if (storedQueuePresence === "absent") {
          return;
        }

        if (storedQueuePresence === "unknown" && wasIdentityAllowed === false) {
          return;
        }

        // The answer can have changed while the probe ran, and clearing then would delete what the
        // person has just allowed again.
        if (isProductAnalyticsCollecting()) {
          return;
        }

        hasOpenedAnalyticsQueue = true;
        // The owner an earlier load stored is released with the events, for the same reason the
        // discard above releases this load's: an account named on a device whose owner is no longer
        // measured is exactly what turning collection off promises to take.
        await clearAnalyticsQueue(true);
      } catch (error) {
        reportAnalyticsQueueFailure(error);
      }
    });
  }

  /**
   * Records the person's answer to the product-analytics setting and carries it out on this load.
   * The caller carries the same answer to the account; this is the browser's half.
   *
   * Turning it off takes everything already collected with it — the stored queue, the events held
   * in memory, the drop counts, and the stored session id — because an off switch that still
   * shipped what it found would report the person after they asked not to be, and a session id left
   * behind is an analytics identifier kept for somebody who is no longer measured. The discard is
   * not reported as a loss, for the same reason the kill switch's own is not: it is the recorded
   * answer taking effect. Events already stored on the server stay; this stops future collection
   * and nothing else.
   *
   * The consent banner's answer is untouched in both directions. The cookie decision is a separate
   * question, and a person turning collection back on is measured under whatever they answered
   * there.
   */
  function applyProductAnalyticsCollection(isCollectionEnabled: boolean): void {
    // Latched before the record, because recording publishes the answer to every subscriber — this
    // runtime included, which is how another tab's answer arrives — and the same answer must not be
    // carried out twice.
    lastCarriedOutCollection = isCollectionEnabled;
    recordProductAnalyticsCollectionDecision(isCollectionEnabled);
    carryOutProductAnalyticsCollection(isCollectionEnabled);
  }

  /**
   * The half of the answer that acts on this load. It runs on the tab the switch was moved in and,
   * from the published answer, on every other tab of this browser — so nothing that may only happen
   * once per answer belongs here.
   */
  function carryOutProductAnalyticsCollection(isCollectionEnabled: boolean): void {
    lastCarriedOutCollection = isCollectionEnabled;
    if (isCollectionEnabled === false) {
      // Before the discard, so a coalescing persist cannot fire between the two and write what the
      // discard is about to take.
      cancelScheduledPersist();
      // The stored owner goes with the events here, where the kill switch keeps its own: an operator
      // turning analytics off leaves a browser that is still measurable the moment they turn it back
      // on, and this leaves one whose person asked to be measured no more. An owner record is an
      // account name stored on that device, and it is normally already on disk by the time this
      // answer arrives: the claim that writes it — and writing it is what creates the analytics
      // database — is legitimate on a fresh browser that holds no answer yet, so an account carrying
      // `productAnalyticsEnabled: false` reaches this with both. Releasing it is what leaves nothing
      // of the account behind. The claim is marked deferred again rather than dropped, because the
      // account is still held in memory and turning collection back on has to write the owner once
      // more before anything may ship under its credential.
      isQueueOwnerReconciled = false;
      isQueueOwnerClaimDeferred = confirmedOwnerId !== null;
      discardQueuedWork({
        shouldReportDiscard: false,
        shouldReleaseOwner: true,
        shouldDiscardHeldEvents: true,
      });
      if (hasOpenedAnalyticsQueue === false) {
        clearStoredQueueAfterCollectionOff();
      }

      resetAnalyticsSession();
      return;
    }

    // A person moving the switch is not the flaky network the mint spacing exists to bound, and the
    // window standing here may have been armed for an attempt the off answer cut short, so the
    // transition back on drops it and the resolution below may mint at once. Every tab carries out
    // the answer, so none of them holds a stale window over a switch just turned back on.
    deferredConsentMintNotBeforeMs = 0;

    // Turning it back on is the first moment an opted-out browser may ask for the shared identity
    // again, exactly as it is for the kill switch: without this a signed-out browser reports nothing
    // until a periodic tick asks, a minute later. Where a grant taken while collection was off left
    // a mint owed, this is also what performs it — the resolution is the one path that does.
    startVisitorIdentityResolution();

    // A queue-owner claim published while collection was off was deferred, exactly as one published
    // under an open consent banner is. The flush below is what normally runs it, but it returns
    // without re-arming anything when one is already in flight, so the transition runs it directly:
    // the claim itself re-checks both gates and simply defers again where one is still shut.
    claimDeferredQueueOwner();
    scheduleFlush(0);
  }

  /**
   * Whether a granted browser carrying no identity still owes the mint `POST`. The `POST` is what
   * such a browser owes: where consent is required the plain `GET` withholds an identity from a
   * browser the server holds no consent record for, so asking again would never mint the identifier
   * the person has already granted.
   *
   * What makes it owed is read rather than remembered — the stored decision says `granted` and the
   * visitor cookie is absent — so this is a fact about the browser, not about the page load that
   * noticed it, and deliberately not about whether an attempt may be made right now.
   *
   * A settled identity is not owed a mint, and that is what stops this from reading true forever.
   * A browser that minted and kept no cookie has the record the server needed and degrades to the
   * per-tab id its grant allows, exactly as one that blocks cookies always has; `granted` alone
   * would otherwise read as owed on every tick for the rest of its life.
   */
  function isDeferredAnalyticsConsentMintOwed(): boolean {
    return readAnalyticsConsentDecision() === "granted"
      && readAnalyticsVisitorId() === null
      && hasResolvedAnalyticsVisitorIdentity() === false;
  }

  /**
   * Attempts the owed mint where both bounds allow one, and does nothing where they do not: a mint
   * already in flight would otherwise be doubled, and a failed one would be retried on the next tick
   * a minute later against a route whose first call can pay a GeoLite download.
   *
   * Its one caller is `startVisitorIdentityResolution`, which the load, the `online` event, the
   * periodic tick and both switches going back on already call, and that is the whole retry story:
   * nothing here schedules anything.
   */
  function attemptDeferredAnalyticsConsentMint(): void {
    if (isConsentIdentityMintInFlight || Date.now() < deferredConsentMintNotBeforeMs) {
      return;
    }

    isConsentIdentityMintInFlight = true;
    // Armed for the attempt, not for one of its outcomes. A `POST` that answers with an identifier
    // this browser cannot store settles nothing: the browser owes the mint still, the flag is down
    // again the moment the attempt ends, and without a window already standing the next tick would
    // answer with a fresh `POST` — one more server-side visitor per minute for the life of the page.
    deferredConsentMintNotBeforeMs = Date.now() + deferredConsentMintRetryDelayMs;
    // Never awaited and never on a render path: nothing analytics does may block or fail a person
    // moving a switch. The `catch` is the file's usual backstop — the request's own failure is
    // handled inside, so only an unexpected throw reaches here and it may not surface.
    void runDeferredAnalyticsConsentMint().catch((): void => undefined);
  }

  /**
   * One attempt at the owed `POST`. A rejected call and an answer carrying no identifier are the
   * same unfinished mint, and neither is answered with the plain `GET`: that `GET` settles the
   * identity on a `granted` browser while the server is still holding no consent record for it,
   * which is precisely the state this exists to leave behind — and the owed check above is what
   * keeps any later caller from issuing it either. It is answered with nothing instead — the browser
   * still owes a mint, nothing recorded that it does not, and the next caller of
   * `startVisitorIdentityResolution` asks again once the spacing allows it.
   */
  async function runDeferredAnalyticsConsentMint(): Promise<void> {
    try {
      let mintedVisitorId: string | null = null;
      try {
        mintedVisitorId = (await submitAnalyticsVisitorConsent(true)).visitorId;
      } catch {
        // Nothing analytics does may surface to the user.
      }

      if (mintedVisitorId === null) {
        return;
      }

      // The switch can go off during the round trip. The cookie the answer planted is already on
      // this browser and is left alone like any other it carries, but nothing further is asked for:
      // resolving here would send one more identity request after the off answer was recorded, and
      // that request re-writes the cookie — the one thing a switched-off browser may never do.
      if (isProductAnalyticsCollecting() === false) {
        return;
      }

      await resolveAnalyticsVisitorIdentityAfterConsentGrant();
    } finally {
      isConsentIdentityMintInFlight = false;
    }

    flush();
  }

  /**
   * The answer another one of this browser's tabs gave. The shared decision reseeds itself from the
   * `storage` event and publishes it here, so this document stops collecting and drops what it holds
   * on the same terms as the tab the switch was moved in, rather than running to the end of its life
   * on the answer it read at boot.
   */
  function handleProductAnalyticsCollectionChange(): void {
    const nextCollection = isProductAnalyticsCollectionEnabled();
    if (nextCollection === lastCarriedOutCollection) {
      return;
    }

    carryOutProductAnalyticsCollection(nextCollection);
  }

  function startAnalytics(): () => void {
    const unsubscribeFromCollection = subscribeToProductAnalyticsCollection(
      handleProductAnalyticsCollectionChange,
    );
    // Subscribing catches every change from here on; this catches the one already published. The
    // shared answer reseeds itself from its own `storage` listener, so a change made in another tab
    // between a teardown and this start updates it while reaching no subscriber — and the latch
    // would still name the answer before it. A later transition back to that same value would then
    // read as already carried out, skipping its discard, session reset and flush.
    handleProductAnalyticsCollectionChange();
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
      unsubscribeFromCollection();
      persistTrackedAnalyticsEvents();
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
    reportIdentityFreeEvent,
    applyAnalyticsConsentGrant,
    applyAnalyticsConsentDecline,
    applyProductAnalyticsCollection,
    flush,
    flushBeforeIdentityTeardown,
    reset,
    setEnabled,
    startAnalytics,
    setAnalyticsConfirmedOwner,
    readAnalyticsSessionOwnerId,
    registerAnalyticsSessionOwnerPublisher,
  };
}
