package com.flashcardsopensourceapp.core.observability.analytics

import android.content.Context
import android.os.Build
import com.flashcardsopensourceapp.core.observability.AndroidAnalyticsObservationName
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import com.flashcardsopensourceapp.core.observability.AppObservability
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.util.concurrent.atomic.AtomicInteger
import java.time.ZoneId
import java.util.Locale
import kotlin.random.Random

/**
 * Maximum number of batches one flush pass will deliver before yielding, so a very large backlog
 * cannot monopolise the worker.
 */
private const val analyticsMaxBatchesPerFlush: Int = 10

private sealed interface AnalyticsCommand {
    data class Enqueue(
        val event: AnalyticsEvent,
        val occurredAtMillis: Long,
        val networkState: AnalyticsNetworkState,
        /**
         * The number of identity boundaries requested when this event was created. The worker
         * refuses any event whose generation is not both the one it has applied and the one
         * currently requested, which is what makes the boundary independent of the order the
         * channel happens to deliver in.
         */
        val identityGeneration: Int
    ) : AnalyticsCommand

    data object Flush : AnalyticsCommand

    data object ConnectivityRestored : AnalyticsCommand

    data object Reset : AnalyticsCommand

    data class SetEnabled(val enabled: Boolean) : AnalyticsCommand
}

/**
 * Durable, batching product-analytics client.
 *
 * Every command is handed to a single consumer coroutine on the IO dispatcher through a bounded
 * channel, so [track] never blocks, never throws and never touches the database or the network on
 * the calling thread, while the consumer still sees writes in order.
 */
class AnalyticsClient internal constructor(
    context: Context,
    private val appScope: CoroutineScope,
    private val identity: AnalyticsIdentity,
    private val credentialProvider: AnalyticsCredentialProvider,
    private val networkStateProvider: AnalyticsNetworkStateProvider,
    private val observability: AppObservability,
    private val appVersion: String?,
    private val versionCode: Int?,
    private val transport: AnalyticsTransport,
    private val deviceContextProvider: () -> AnalyticsDeviceContext = ::currentAnalyticsDeviceContext,
    private val currentTimeMillisProvider: () -> Long = System::currentTimeMillis
) : Analytics {
    constructor(
        context: Context,
        appScope: CoroutineScope,
        okHttpClient: OkHttpClient,
        identity: AnalyticsIdentity,
        credentialProvider: AnalyticsCredentialProvider,
        networkStateProvider: AnalyticsNetworkStateProvider,
        observability: AppObservability,
        appVersion: String?,
        versionCode: Int?
    ) : this(
        context = context,
        appScope = appScope,
        identity = identity,
        credentialProvider = credentialProvider,
        networkStateProvider = networkStateProvider,
        observability = observability,
        appVersion = appVersion,
        versionCode = versionCode,
        transport = OkHttpAnalyticsTransport(okHttpClient = okHttpClient)
    )

    private val applicationContext: Context = context.applicationContext

    // Lazy on purpose: app start never waits for the queue to open.
    private val databaseHolder: Lazy<AnalyticsDatabase> = lazy {
        buildAnalyticsDatabase(context = applicationContext)
    }
    private val database: AnalyticsDatabase
        get() = databaseHolder.value

    private val commands = Channel<AnalyticsCommand>(capacity = 512)

    @Volatile
    private var enabled: Boolean = true

    private val pendingDropCounts: MutableMap<AnalyticsDroppedReason, Int> = mutableMapOf()
    private val handoffOverflowCount = AtomicInteger(0)

    /**
     * Identity boundaries requested so far, bumped synchronously inside [reset].
     *
     * This is the **in-process** half of the boundary only; the durable half is the rotation [reset]
     * performs on the caller's thread. The counter exists because the [AnalyticsCommand.Reset]
     * hand-off is droppable — a full channel would silently lose it — and because channel ordering
     * is only guaranteed per calling thread: an event tracked on another thread just before the
     * boundary carries the old generation and is refused even if its hand-off arrives after it.
     *
     * The counter is bumped before the rotation on purpose. The reverse order has a window in which
     * an event created under the old generation is stored under the new `anonymous_id`, which is
     * misattribution; this order's window instead stores an event under the old id after the queue
     * was emptied, and the stored-id filter then discards it. This module prefers undercounting.
     */
    private val requestedIdentityGeneration = AtomicInteger(0)

    /** Worker-confined: the generation the queue and `anonymous_id` currently belong to. */
    private var appliedIdentityGeneration: Int = 0
    private val reportedObservationNames: MutableSet<AndroidAnalyticsObservationName> = mutableSetOf()
    private var consecutiveDeliveryFailureCount: Int = 0
    private var nextDeliveryAttemptAtMillis: Long = 0L
    private var isDeliveryBackoffFromTransportFailure: Boolean = false
    private var firstServerErrorAtMillis: Long? = null

    init {
        startCommandWorker()
        startPeriodicFlush()
    }

    override fun track(event: AnalyticsEvent) {
        if (!enabled) {
            return
        }

        val occurredAtMillis: Long = currentTimeMillisProvider()
        // Both readings belong to the moment the event is created. The worker can be parked inside
        // a flush for several batches of network I/O, so reading the network state there could
        // relabel an event created offline as `wifi`, losing the one value the column exists for.
        val networkState: AnalyticsNetworkState = networkStateProvider.currentNetworkState()
        val enqueued: Boolean = commands.trySend(
            AnalyticsCommand.Enqueue(
                event = event,
                occurredAtMillis = occurredAtMillis,
                networkState = networkState,
                identityGeneration = requestedIdentityGeneration.get()
            )
        ).isSuccess
        if (!enqueued) {
            // Drop rather than wait: a full hand-off buffer may never delay the caller.
            recordHandoffOverflow()
        }
    }

    override fun flush() {
        if (!enabled) {
            return
        }
        commands.trySend(AnalyticsCommand.Flush)
    }

    override fun onConnectivityRestored() {
        if (!enabled) {
            return
        }
        commands.trySend(AnalyticsCommand.ConnectivityRestored)
    }

    override fun reset() {
        // The counter closes the in-process hole; the hand-off below only makes the cleanup prompt.
        // A boundary command must not be droppable, and `trySend` is: on a full channel the queue
        // would survive the logout and ship under the next credential.
        requestedIdentityGeneration.incrementAndGet()
        // The durable half, synchronously on the caller's thread. An in-process counter says
        // nothing on disk, so deferring this to the worker leaves a window — the worker can be
        // parked inside a flush for several batches of network I/O, and force-quitting after
        // signing out is an ordinary thing to do — in which a process death loses the boundary
        // entirely: the queue still holds the outgoing person's rows, `anonymous_id` is still
        // theirs, and the next launch starts at generation zero with nothing to detect. Rotating
        // here instead makes the boundary hold on its own, because every queued row now carries a
        // stale `anonymousId` and neither batch selection nor delivery will touch one.
        //
        // It is one `SharedPreferences` commit and no network or database work, and all three hook
        // sites already run inside `CloudIdentityResetCoordinator`'s `withContext(Dispatchers.IO)`,
        // so nothing on the interaction path waits for it.
        identity.rotateForLogout()
        commands.trySend(AnalyticsCommand.Reset)
    }

    override fun setEnabled(enabled: Boolean) {
        this.enabled = enabled
        commands.trySend(AnalyticsCommand.SetEnabled(enabled = enabled))
    }

    /**
     * Releases the queue's SQLite connection. Call it only once the scope that owns the command
     * worker has been cancelled. Production never rebuilds the graph, but the instrumentation reset
     * rule does it several times per test, and without this every run leaks a connection on one
     * file across the whole suite.
     */
    fun close() {
        commands.close()
        if (databaseHolder.isInitialized()) {
            databaseHolder.value.close()
        }
    }

    private fun startCommandWorker() {
        appScope.launch(Dispatchers.IO) {
            for (command in commands) {
                try {
                    // Before anything else, so no command can reach the queue or the network with a
                    // requested boundary still unapplied.
                    applyRequestedIdentityBoundary()
                    when (command) {
                        is AnalyticsCommand.Enqueue -> handleEnqueue(
                            event = command.event,
                            occurredAtMillis = command.occurredAtMillis,
                            networkState = command.networkState,
                            identityGeneration = command.identityGeneration
                        )

                        AnalyticsCommand.Flush -> handleFlush()
                        AnalyticsCommand.ConnectivityRestored -> handleConnectivityRestored()
                        // Already applied above; the command only exists to wake the worker.
                        AnalyticsCommand.Reset -> Unit
                        is AnalyticsCommand.SetEnabled -> handleSetEnabled(enabled = command.enabled)
                    }
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    reportOnce(
                        name = when (command) {
                            is AnalyticsCommand.Enqueue -> AndroidAnalyticsObservationName.QUEUE_STORE_WRITE_FAILED
                            else -> AndroidAnalyticsObservationName.QUEUE_STORE_READ_FAILED
                        }
                    )
                }
            }
        }
    }

    private fun startPeriodicFlush() {
        appScope.launch(Dispatchers.IO) {
            while (isActive) {
                delay(analyticsPeriodicFlushIntervalMillis)
                flush()
            }
        }
    }

    private suspend fun handleEnqueue(
        event: AnalyticsEvent,
        occurredAtMillis: Long,
        networkState: AnalyticsNetworkState,
        identityGeneration: Int
    ) {
        if (!enabled) {
            return
        }

        // Read before the generation checks, never at insert time: `serializeAnalyticsEvent` and
        // `enforceQueueCaps` suspend on the database in between, and a [reset] landing inside that
        // window would otherwise store a pre-boundary event under the **next** person's
        // `anonymous_id` — misattribution, the one direction this module never takes.
        //
        // Reading it here makes the boundary hold rather than merely be unlikely, because [reset]
        // bumps the counter before it rotates: if this read returned the rotated id then the bump
        // already happened, so the live counter below has moved and the event is refused. If the
        // checks pass instead, the rotation had not happened yet, this is the outgoing person's id,
        // and every delivery path filters on the stored id.
        val anonymousId: String = identity.currentAnonymousId()
        if (
            identityGeneration != appliedIdentityGeneration ||
            identityGeneration != requestedIdentityGeneration.get()
        ) {
            // Created on the other side of an identity boundary — one already applied, or one
            // requested since this command was picked up. Storing it would let it ship under the
            // next person's credential, which this module never allows: it prefers undercounting to
            // misattribution.
            return
        }

        val dao: AnalyticsQueueDao = database.analyticsQueueDao()
        val serializedEvent: AnalyticsSerializedEvent = serializeAnalyticsEvent(
            event = event,
            eventId = newAnalyticsEventId(epochMillis = occurredAtMillis),
            occurredAtMillis = occurredAtMillis,
            networkState = networkState
        )

        if (serializedEvent.byteSize > analyticsMaxEventBytes) {
            // The server would refuse it; refusing it here keeps the batch it would have poisoned.
            recordDropped(reason = AnalyticsDroppedReason.REJECTED, count = 1)
            reportOnce(name = AndroidAnalyticsObservationName.BATCH_CONTRACT_REFUSED)
            return
        }

        enforceQueueCaps(dao = dao, incomingByteSize = serializedEvent.byteSize)
        dao.insert(
            entity = AnalyticsQueuedEventEntity(
                eventId = serializedEvent.eventId,
                eventName = serializedEvent.eventName,
                eventJson = serializedEvent.json,
                byteSize = serializedEvent.byteSize,
                createdAtMillis = occurredAtMillis,
                anonymousId = anonymousId,
                // Read at insert time on purpose, unlike the id above: it advances `last_event_at`,
                // and an event that was refused must not move the session clock.
                sessionId = identity.sessionIdForEvent(nowMillis = occurredAtMillis)
            )
        )

        if (dao.countEvents() >= analyticsFlushBatchThreshold) {
            handleFlush()
        }
    }

    /**
     * The asynchronous half of an identity boundary: [reset] has already rotated `anonymous_id` on
     * disk, so this only empties the queue and advances the applied generation.
     *
     * It deliberately does **not** rotate again. The rotation is durable and belongs to the thread
     * that asked for the boundary; repeating it here would mint a second `anonymous_id` for one
     * logout, and — because a persistently failing delete leaves the boundary pending — a fresh one
     * on every subsequent command, each with its own synchronous commit. Rotate once, retry only
     * the delete.
     *
     * The delete is cleanup rather than the boundary itself: from the rotation onwards every queued
     * row carries a stale `anonymousId`, and neither batch selection nor
     * [purgeEventsFromPreviousIdentities] will ever hand one to the server, so a delete that never
     * succeeds costs queue space and nothing else.
     *
     * The applied generation advances only once the delete has succeeded. A failure therefore leaves
     * the boundary pending and retries on the next command, and until then every enqueue is refused
     * as out of generation, which is the conservative direction.
     *
     * Several boundaries in a row coalesce: any number of consecutive boundaries needs exactly one
     * empty queue, and the enqueue generation check discards whatever was created between them.
     *
     * The loss is reported through the platform's error reporter rather than counted into
     * `analytics_events_dropped`: that `reason` enum is frozen, and `rejected` has to keep meaning
     * a real server refusal.
     */
    private suspend fun applyRequestedIdentityBoundary() {
        val requestedGeneration: Int = requestedIdentityGeneration.get()
        if (requestedGeneration == appliedIdentityGeneration) {
            return
        }

        val discardedCount: Int = database.analyticsQueueDao().deleteAll()
        pendingDropCounts.clear()
        handoffOverflowCount.set(0)
        appliedIdentityGeneration = requestedGeneration
        if (discardedCount > 0) {
            reportOnce(
                name = AndroidAnalyticsObservationName.IDENTITY_BOUNDARY_DISCARDED,
                eventCount = discardedCount
            )
        }
    }

    /**
     * Connectivity is back. An offline stretch must not leave the queue parked behind a backoff
     * that only a transport failure produced, which is exactly what the connectivity flush trigger
     * exists to prevent. A `429`/`5xx` backoff is server pressure and is left in place.
     */
    private suspend fun handleConnectivityRestored() {
        if (isDeliveryBackoffFromTransportFailure) {
            isDeliveryBackoffFromTransportFailure = false
            nextDeliveryAttemptAtMillis = 0L
        }
        handleFlush()
    }

    private suspend fun handleSetEnabled(enabled: Boolean) {
        if (enabled) {
            return
        }
        // Nothing captured before the kill switch may leave the device afterwards.
        database.analyticsQueueDao().deleteAll()
        pendingDropCounts.clear()
        handoffOverflowCount.set(0)
    }

    private suspend fun handleFlush() {
        if (!enabled) {
            return
        }

        val nowMillis: Long = currentTimeMillisProvider()
        // Every backoff this client schedules is capped at [analyticsMaxRetryDelayMillis], including
        // a `Retry-After`, so a deadline further out than the cap cannot have been scheduled against
        // the clock now being read: the wall clock moved backwards after it was set. Waiting for
        // wall time to catch up would park the queue — and with it the TTL purge below — for the
        // size of the jump, until the caps started dropping the oldest events.
        if (nextDeliveryAttemptAtMillis - nowMillis > analyticsMaxRetryDelayMillis) {
            nextDeliveryAttemptAtMillis = nowMillis
        }
        if (nowMillis < nextDeliveryAttemptAtMillis) {
            return
        }

        val dao: AnalyticsQueueDao = database.analyticsQueueDao()
        purgeExpiredEvents(dao = dao, nowMillis = nowMillis)
        purgeEventsFromPreviousIdentities(dao = dao)
        materializePendingDrops(dao = dao, nowMillis = nowMillis)

        // Never send an unauthenticated batch: without a credential the events stay queued.
        val credential: AnalyticsCredential = credentialProvider.currentCredential() ?: return
        val deviceContext: AnalyticsDeviceContext = deviceContextProvider()

        var deliveredBatchCount = 0
        while (deliveredBatchCount < analyticsMaxBatchesPerFlush) {
            // Selection is filtered on the stored `anonymous_id` rather than on whatever row happens
            // to be oldest, so a delete that failed at a boundary — or one that never ran because
            // the process died before the worker woke — still cannot put a departed person's events
            // on the wire. Re-read per batch: a logout may land between two batches of one flush.
            val currentAnonymousId: String = identity.currentAnonymousId()
            val oldestEvent: AnalyticsQueuedEventEntity =
                dao.oldestEventForAnonymousId(anonymousId = currentAnonymousId) ?: return
            val batch: List<AnalyticsQueuedEventEntity> = takeBatchWithinBodyLimit(
                events = dao.oldestEventsForIdentity(
                    anonymousId = currentAnonymousId,
                    sessionId = oldestEvent.sessionId,
                    limit = analyticsMaxEventsPerBatch
                )
            )
            if (batch.isEmpty()) {
                return
            }

            val delivered: Boolean = deliverBatch(
                dao = dao,
                credential = credential,
                deviceContext = deviceContext,
                batch = batch
            )
            if (!delivered) {
                return
            }
            deliveredBatchCount += 1
        }
    }

    /**
     * Delivers one batch, splitting it on a whole-batch refusal until every part either lands or is
     * dropped. Splitting terminates and cannot wedge the queue behind a single poison event.
     */
    private suspend fun deliverBatch(
        dao: AnalyticsQueueDao,
        credential: AnalyticsCredential,
        deviceContext: AnalyticsDeviceContext,
        batch: List<AnalyticsQueuedEventEntity>
    ): Boolean {
        val pendingChunks: ArrayDeque<List<AnalyticsQueuedEventEntity>> = ArrayDeque()
        pendingChunks.addLast(batch)

        while (pendingChunks.isNotEmpty()) {
            val chunk: List<AnalyticsQueuedEventEntity> = pendingChunks.removeFirst()
            val outcome: AnalyticsBatchOutcome = transport.sendBatch(
                credential = credential,
                clientVersion = appVersion,
                body = renderAnalyticsBatchBody(
                    // Stamped now, not when the events were created: the server derives
                    // `occurred_at` from the interval between the two.
                    clientSentAtMillis = currentTimeMillisProvider(),
                    anonymousId = chunk.first().anonymousId,
                    sessionId = chunk.first().sessionId,
                    deviceContext = deviceContext,
                    eventJsonPayloads = chunk.map { queuedEvent -> queuedEvent.eventJson }
                )
            )

            when (outcome) {
                is AnalyticsBatchOutcome.Finished -> {
                    // A 200 finishes the batch. `accepted` is a count only and rejected events are
                    // permanently refused, so everything that was sent is purged by what was sent.
                    dao.deleteByIds(eventIds = chunk.map { queuedEvent -> queuedEvent.eventId })
                    if (outcome.rejectedCount > 0 && !containsOnlyDropEvents(chunk = chunk)) {
                        recordDropped(
                            reason = AnalyticsDroppedReason.REJECTED,
                            count = outcome.rejectedCount
                        )
                    }
                    onDeliverySucceeded()
                }

                is AnalyticsBatchOutcome.WholeBatchRefused -> {
                    reportOnce(name = AndroidAnalyticsObservationName.BATCH_CONTRACT_REFUSED)
                    if (chunk.size > 1) {
                        val midpoint: Int = chunk.size / 2
                        pendingChunks.addFirst(chunk.subList(midpoint, chunk.size).toList())
                        pendingChunks.addFirst(chunk.subList(0, midpoint).toList())
                    } else {
                        // Retrying the same bytes fails identically forever.
                        dao.deleteByIds(eventIds = chunk.map { queuedEvent -> queuedEvent.eventId })
                        if (!containsOnlyDropEvents(chunk = chunk)) {
                            recordDropped(
                                reason = AnalyticsDroppedReason.REJECTED,
                                count = chunk.size
                            )
                        }
                    }
                }

                is AnalyticsBatchOutcome.RetryLater -> {
                    noteServerError(statusCode = outcome.statusCode)
                    scheduleRetry(retryAfterMillis = outcome.retryAfterMillis)
                    return false
                }

                is AnalyticsBatchOutcome.CredentialRefused -> {
                    // Keep the events queued against a future valid credential; do not spin. The
                    // provider is told so it can retire a credential it owns: a backoff alone would
                    // present the same refused credential on every flush until the queue TTL.
                    credentialProvider.onCredentialRefused(
                        credential = credential,
                        statusCode = outcome.statusCode
                    )
                    scheduleRetry(retryAfterMillis = null)
                    return false
                }

                AnalyticsBatchOutcome.TransportFailure -> {
                    // Being offline is not server pressure. It must not grow the same backoff
                    // towards the one-hour cap, or connectivity coming back would find the queue
                    // parked for an hour behind a window nothing had a reason to open.
                    scheduleTransportFailureRetry()
                    return false
                }
            }
        }

        return true
    }

    private fun onDeliverySucceeded() {
        consecutiveDeliveryFailureCount = 0
        nextDeliveryAttemptAtMillis = 0L
        isDeliveryBackoffFromTransportFailure = false
        firstServerErrorAtMillis = null
    }

    /**
     * A short fixed pause that keeps an offline device from re-attempting on every enqueued event,
     * and that [handleConnectivityRestored] can clear outright.
     */
    private fun scheduleTransportFailureRetry() {
        isDeliveryBackoffFromTransportFailure = true
        nextDeliveryAttemptAtMillis = currentTimeMillisProvider() + analyticsInitialRetryDelayMillis
    }

    /**
     * `Retry-After` wins when present, and local exponential backoff with full jitter covers the
     * answers that never carry it, such as the API Gateway throttle refusal.
     */
    private fun scheduleRetry(retryAfterMillis: Long?) {
        isDeliveryBackoffFromTransportFailure = false
        consecutiveDeliveryFailureCount += 1
        val delayMillis: Long = if (retryAfterMillis != null) {
            retryAfterMillis
        } else {
            val exponentialCeilingMillis: Long = analyticsInitialRetryDelayMillis
                .shl(minOf(consecutiveDeliveryFailureCount - 1, 10))
                .coerceIn(analyticsInitialRetryDelayMillis, analyticsMaxRetryDelayMillis)
            Random.nextLong(from = 0L, until = exponentialCeilingMillis + 1L)
        }
        nextDeliveryAttemptAtMillis = currentTimeMillisProvider() +
            delayMillis.coerceIn(0L, analyticsMaxRetryDelayMillis)
    }

    private fun noteServerError(statusCode: Int) {
        if (statusCode < 500) {
            firstServerErrorAtMillis = null
            return
        }

        val nowMillis: Long = currentTimeMillisProvider()
        val firstErrorAtMillis: Long = firstServerErrorAtMillis ?: nowMillis.also {
            firstServerErrorAtMillis = nowMillis
        }
        if (nowMillis - firstErrorAtMillis > analyticsSustainedServerErrorReportAfterMillis) {
            reportOnce(
                name = AndroidAnalyticsObservationName.SUSTAINED_SERVER_ERRORS,
                statusCode = statusCode
            )
        }
    }

    /**
     * The delivery-side half of the identity boundary. A row whose `anonymousId` is no longer the
     * current one was created by somebody who has since left this install, and the credential in
     * hand now belongs to somebody else, so it can never be delivered. Normally
     * [applyRequestedIdentityBoundary] already emptied the queue and this finds nothing; it is what
     * makes the boundary hold when that delete failed, or never ran at all because the process died
     * between [reset]'s rotation and the worker waking up.
     */
    private suspend fun purgeEventsFromPreviousIdentities(dao: AnalyticsQueueDao) {
        val discardedCount: Int = dao.deleteForOtherAnonymousIds(
            anonymousId = identity.currentAnonymousId()
        )
        if (discardedCount > 0) {
            reportOnce(
                name = AndroidAnalyticsObservationName.IDENTITY_BOUNDARY_DISCARDED,
                eventCount = discardedCount
            )
        }
    }

    private suspend fun purgeExpiredEvents(
        dao: AnalyticsQueueDao,
        nowMillis: Long
    ) {
        val expiredCount: Int = dao.deleteExpired(cutoffMillis = nowMillis - analyticsQueueTtlMillis)
        if (expiredCount > 0) {
            recordDropped(reason = AnalyticsDroppedReason.TTL_EXPIRED, count = expiredCount)
            reportOnce(
                name = AndroidAnalyticsObservationName.QUEUE_TTL_EXPIRED,
                eventCount = expiredCount
            )
        }
    }

    private suspend fun enforceQueueCaps(
        dao: AnalyticsQueueDao,
        incomingByteSize: Int
    ) {
        var overflowCount = 0

        val queuedEventCount: Int = dao.countEvents()
        if (queuedEventCount + 1 > analyticsMaxQueuedEvents) {
            overflowCount += dao.deleteOldest(limit = queuedEventCount + 1 - analyticsMaxQueuedEvents)
        }

        while (dao.totalByteSize() + incomingByteSize > analyticsMaxQueuedBytes) {
            val removedCount: Int = dao.deleteOldest(limit = analyticsMaxEventsPerBatch)
            if (removedCount <= 0) {
                break
            }
            overflowCount += removedCount
        }

        if (overflowCount > 0) {
            recordDropped(reason = AnalyticsDroppedReason.QUEUE_OVERFLOW, count = overflowCount)
            reportOnce(
                name = AndroidAnalyticsObservationName.QUEUE_OVERFLOW,
                eventCount = overflowCount
            )
        }
    }

    /**
     * Turns the accumulated loss counters into `analytics_events_dropped` events so the loss shows
     * up in the data itself and not only in server-side telemetry. Counters are aggregated rather
     * than emitted one per drop, which also keeps a drop from causing another drop.
     */
    private suspend fun materializePendingDrops(
        dao: AnalyticsQueueDao,
        nowMillis: Long
    ) {
        val handoffOverflow: Int = handoffOverflowCount.getAndSet(0)
        if (handoffOverflow > 0) {
            recordDropped(reason = AnalyticsDroppedReason.QUEUE_OVERFLOW, count = handoffOverflow)
            reportOnce(
                name = AndroidAnalyticsObservationName.QUEUE_OVERFLOW,
                eventCount = handoffOverflow
            )
        }

        if (pendingDropCounts.isEmpty()) {
            return
        }

        val drops: Map<AnalyticsDroppedReason, Int> = pendingDropCounts.toMap()
        pendingDropCounts.clear()
        drops.forEach { (reason, count) ->
            if (count <= 0) {
                return@forEach
            }
            val serializedEvent: AnalyticsSerializedEvent = serializeAnalyticsEvent(
                event = AnalyticsEvent.AnalyticsEventsDropped(reason = reason, count = count),
                eventId = newAnalyticsEventId(epochMillis = nowMillis),
                occurredAtMillis = nowMillis,
                networkState = networkStateProvider.currentNetworkState()
            )
            dao.insert(
                entity = AnalyticsQueuedEventEntity(
                    eventId = serializedEvent.eventId,
                    eventName = serializedEvent.eventName,
                    eventJson = serializedEvent.json,
                    byteSize = serializedEvent.byteSize,
                    createdAtMillis = nowMillis,
                    anonymousId = identity.currentAnonymousId(),
                    sessionId = identity.sessionIdForEvent(nowMillis = nowMillis)
                )
            )
        }
    }

    private fun recordDropped(
        reason: AnalyticsDroppedReason,
        count: Int
    ) {
        if (count <= 0) {
            return
        }
        pendingDropCounts[reason] = (pendingDropCounts[reason] ?: 0) + count
    }

    /** Reached from any thread, so the loss is only counted here and accounted for on the worker. */
    private fun recordHandoffOverflow() {
        handoffOverflowCount.incrementAndGet()
    }

    private fun reportOnce(
        name: AndroidAnalyticsObservationName,
        eventCount: Int? = null,
        statusCode: Int? = null
    ) {
        if (!reportedObservationNames.add(name)) {
            return
        }
        observability.captureWarning(
            event = AndroidWarningIssueEvent.AnalyticsPipelineWarning(
                name = name,
                eventCount = eventCount,
                statusCode = statusCode,
                appVersion = appVersion,
                clientVersion = appVersion,
                versionCode = versionCode
            )
        )
    }
}

/**
 * A rejection is itself a loss, and a loss emits `analytics_events_dropped`. When the refused batch
 * held nothing but drop events, counting the refusal would emit another drop event that is refused
 * for the same reason: net queue change zero and a device posting forever, which one install can
 * use to consume the endpoint's whole per-method throttle. Discard those instead.
 */
private fun containsOnlyDropEvents(chunk: List<AnalyticsQueuedEventEntity>): Boolean {
    return chunk.all { queuedEvent -> queuedEvent.eventName == analyticsEventsDroppedEventName }
}

/**
 * Trims a batch so the serialized body cannot exceed the request-body limit. Fifty events at the
 * per-event limit already fit, so this only matters if either server limit ever moves.
 */
private fun takeBatchWithinBodyLimit(
    events: List<AnalyticsQueuedEventEntity>
): List<AnalyticsQueuedEventEntity> {
    val bodyBudgetBytes: Int = analyticsMaxRequestBodyBytes - analyticsBatchEnvelopeHeadroomBytes
    var usedBytes = 0
    val batch = mutableListOf<AnalyticsQueuedEventEntity>()
    for (event in events) {
        val nextUsedBytes: Int = usedBytes + event.byteSize + 1
        if (batch.isNotEmpty() && nextUsedBytes > bodyBudgetBytes) {
            break
        }
        batch += event
        usedBytes = nextUsedBytes
    }
    return batch
}

private const val analyticsBatchEnvelopeHeadroomBytes: Int = 2_048

/** Describes the device at flush time; every field is capped at 200 characters server-side. */
fun currentAnalyticsDeviceContext(): AnalyticsDeviceContext {
    return AnalyticsDeviceContext(
        osVersion = Build.VERSION.RELEASE,
        deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}",
        deviceLocale = Locale.getDefault().toLanguageTag(),
        timezone = ZoneId.systemDefault().id
    )
}
