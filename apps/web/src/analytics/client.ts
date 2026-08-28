import {
  ApiError,
  getCachedSessionCsrfToken,
  sendAnalyticsEventsBatch,
  type AnalyticsIngestResult,
} from "../api";
import {
  analyticsCatalogSlugPattern,
  type AnalyticsDropReason,
  type AnalyticsEvent,
  type AnalyticsSurface,
  type AnalyticsWireBatch,
} from "./events";
import {
  readAnalyticsAnonymousId,
  readAnalyticsSessionId,
  readStoredAnalyticsEnabled,
  resetAnalyticsIdentity,
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
  readOldestAnalyticsEvents,
  removeAnalyticsEvents,
  type AnalyticsQueueRecord,
  type QueuedAnalyticsEvent,
} from "./queue";
import {
  buildAnalyticsWireContext,
  measureAnalyticsWireEventBytes,
  toAnalyticsTimestamp,
  toAnalyticsWireEvent,
} from "./wire";

/**
 * Product analytics client. Emitting an event is fire-and-forget into a durable local queue: nothing
 * here is awaited by a user action, and every network path runs on a background task.
 */

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

let isEnabled = readInitialEnabled();
let currentSurface: AnalyticsSurface | null = null;
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
 * Cleared the moment a new owner is published, set again only once the queue's stored owner has been
 * reconciled with it. It never widens what may be sent — the stored-owner comparison in `runFlush` is
 * the guarantee — it only keeps a flush out of the window in which a claim has already rewritten the
 * stored owner but the outgoing `anonymous_id` has not been rotated yet.
 */
let isQueueOwnerReconciled = false;
/**
 * Bumped every time the queue and the identity behind it are torn down, by `reset()`, by the kill
 * switch, or by a newly published owner. A flush captures it at the start and rechecks it before it
 * may send or purge anything, so work started under one identity can never be attributed to, or
 * delete events of, the next one.
 */
let analyticsGeneration = 0;

/** Losses are counted here and emitted as `analytics_events_dropped` on the next flush. */
function countDropped(reason: AnalyticsDropReason, count: number): void {
  if (count <= 0) {
    return;
  }

  pendingDropCounts.set(reason, (pendingDropCounts.get(reason) ?? 0) + count);
}

function enqueueEvent(event: AnalyticsEvent): void {
  const nowMs = Date.now();
  const sessionId = readAnalyticsSessionId(nowMs);
  const wireEvent = toAnalyticsWireEvent(event, nowMs, currentSurface);
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
    enqueueEvent({ name: "analytics_events_dropped", reason, count });
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

async function deliverBatch(
  events: ReadonlyArray<QueuedAnalyticsEvent>,
  flushGeneration: number,
): Promise<void> {
  // Rechecked synchronously immediately before the batch is built, and nothing between this line and
  // the request may await: `buildWireBatch` reads the current `anonymousId`, so a `reset()` landing
  // in the queue round trips above would otherwise ship the previous account's events under the next
  // account's id. The server resolves `analytics.identity_links` first-link-wins on an append-only
  // table, so that merge of two people is permanent and has no repair path.
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
  const flushGeneration = analyticsGeneration;
  try {
    drainDropReports();
    await persistPendingRecords();

    const queued = await readOldestAnalyticsEvents(batchEventLimit, Date.now());
    if (queued.expiredCount > 0) {
      countDropped("ttl_expired", queued.expiredCount);
      reportAnalyticsQueueTtlExpiry(queued.expiredCount);
    }

    // Never send an unauthenticated batch, and never send one whose owner is not the account the
    // credential belongs to. The owner comes back from the same transaction that produced these
    // events, so this is a comparison of two recorded facts rather than an assumption about when the
    // session layer's cleanup happens to run. Refusing here only holds events back: they stay in the
    // queue under the 14-day TTL and ship on a later load that does confirm an owner.
    if (
      queued.events.length === 0
      || confirmedOwnerId === null
      || isQueueOwnerReconciled === false
      || queued.ownerId !== confirmedOwnerId
      || getCachedSessionCsrfToken() === null
    ) {
      return;
    }

    hasDeliveredInFlush = false;
    remainingFlushRequestCount = flushRequestBudget;
    const sendableEvents = takeLeadingSessionRun(queued.events);
    await deliverBatch(sendableEvents, flushGeneration);
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
 * somebody else is discarded here, together with the `anonymous_id` created alongside it, rather than
 * being shipped under the new credential: `analytics.identity_links` resolves first-link-wins on an
 * append-only table, so fusing two people there is permanent and has no repair path.
 */
function claimQueueOwner(userId: string): void {
  // Chained onto the persist task like every other queue operation, so a claim can neither interleave
  // with a write nor leave the chain rejected for the writes behind it.
  persistTask = persistTask.then(async (): Promise<void> => {
    try {
      const claim = await claimAnalyticsQueueOwner(userId);
      if (claim.didReplaceForeignOwner) {
        resetAnalyticsIdentity();
        if (claim.discardedEventCount > 0) {
          reportAnalyticsQueueDiscardedOnReset(claim.discardedEventCount);
        }
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
 * Publishes the account the current credential belongs to. Call it wherever the session layer has
 * verified a session; publishing late only delays delivery, and never publishing at all only holds
 * events in the queue for the next page load, because nothing is sent until a published owner and the
 * queue's stored owner name the same person.
 */
export function setAnalyticsConfirmedOwner(userId: string): void {
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

/** Records the surface stamped onto every event that does not declare its own. */
export function setCurrentAnalyticsSurface(surface: AnalyticsSurface | null): void {
  currentSurface = surface;
}

/**
 * Emits one event into the local queue. Synchronous, returns void, and cannot throw: a user action
 * is never blocked, delayed, or failed by anything in this module.
 */
export function track(event: AnalyticsEvent): void {
  try {
    if (isEnabled === false) {
      return;
    }

    enqueueEvent(event);
    trackedSinceFlushCount += 1;
    schedulePersist();
  } catch {
    // A failure inside analytics is swallowed on purpose; the queue reporting path covers the rest.
  }
}

/**
 * `package_slug` is a declared string property with a slug pattern, so a slug the catalog cannot
 * produce is skipped rather than shipped as an event the server would reject.
 */
export function trackCatalogDeckInstallStarted(packageSlug: string): void {
  if (analyticsCatalogSlugPattern.test(packageSlug) === false) {
    return;
  }

  track({ name: "catalog_deck_install_started", packageSlug });
}

export function flush(): void {
  void runFlush();
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
 * Rotates `anonymous_id` and drops queued events so they cannot be attributed to the next account.
 *
 * The plan's "before logout" flush trigger is deliberately not implemented here, because on web
 * there is no moment at which it would be safe. Signing out leaves for the auth origin, so every
 * caller of this function runs on a *later* app start: `logout_marker` and `account_deleted_marker`
 * run when the credential is already gone, and `confirmed_account_switch` / `reauth_owner_unknown`
 * run right after `getSession()` returned a session belonging to somebody else. Flushing there would
 * post the previous account's events on the new account's credential, which is exactly the
 * unrepairable identity merge the whole reset path exists to prevent. What the trigger was meant to
 * catch is instead covered by the existing tab-hidden flush, which fires while the credential is
 * still the user's own as the sign-out link navigates away. The events this call does discard are
 * counted and reported rather than lost silently.
 */
export function reset(): void {
  try {
    // The stored queue owner is released with the events: the next account confirmed on this browser
    // then adopts an empty queue instead of inheriting one, and until one is confirmed the gate in
    // `runFlush` refuses to send at all.
    confirmedOwnerId = null;
    isQueueOwnerReconciled = false;
    discardQueuedWork(true, true);
    resetAnalyticsIdentity();
  } catch {
    // Logout cleanup must not fail because analytics could not reset.
  }
}

/** Kill switch. Honored immediately and remembered, so analytics can be turned off without a release. */
export function setEnabled(enabled: boolean): void {
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

    scheduleFlush(0);
  } catch {
    // The in-memory flag already took effect.
  }
}

/**
 * Callbacks that must emit their closing events before the page-hide flush reads the queue. Two
 * independent `visibilitychange` listeners run in registration order, which no caller controls, and a
 * screen whose event lands after the flush keeps it queued until a later trigger — which for a
 * sign-out navigation is a boot that discards it at the identity boundary. Registering here makes the
 * dependency explicit instead of leaving it to whichever listener was added first.
 */
const pageHideCollectors = new Set<() => void>();

export function registerAnalyticsPageHideCollector(collector: () => void): () => void {
  pageHideCollectors.add(collector);
  return (): void => {
    pageHideCollectors.delete(collector);
  };
}

function runPageHideCollectors(): void {
  for (const collector of [...pageHideCollectors]) {
    try {
      collector();
    } catch {
      // One collector failing must not stop the others, the persist, or the flush.
    }
  }
}

export function startAnalytics(): () => void {
  function handleVisibilityChange(): void {
    if (document.visibilityState === "hidden") {
      runPageHideCollectors();
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

    flush();
  }

  function handlePageHide(): void {
    runPageHideCollectors();
    persistTrackedAnalyticsEvents();
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("online", handleOnline);
  window.addEventListener("pagehide", handlePageHide);
  const intervalId = window.setInterval((): void => {
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
