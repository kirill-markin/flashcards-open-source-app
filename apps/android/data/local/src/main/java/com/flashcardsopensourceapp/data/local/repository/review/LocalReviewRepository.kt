package com.flashcardsopensourceapp.data.local.repository.review

import android.net.Uri
import androidx.room.withTransaction
import com.flashcardsopensourceapp.core.observability.analytics.Analytics
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.core.observability.analytics.FirstReviewOnboardingSource
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.CardEntity
import com.flashcardsopensourceapp.data.local.database.entities.CardWithRelations
import com.flashcardsopensourceapp.data.local.database.entities.DeckEntity
import com.flashcardsopensourceapp.data.local.database.entities.MediaBlobCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.MediaAssetEntity
import com.flashcardsopensourceapp.data.local.database.entities.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.cards.CardSummary
import com.flashcardsopensourceapp.data.local.model.cards.DeckSummary
import com.flashcardsopensourceapp.data.local.model.media.MediaAsset
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetDownloadUrl
import com.flashcardsopensourceapp.data.local.model.media.ReviewMediaAssetFile
import com.flashcardsopensourceapp.data.local.model.media.buildMediaBlobCacheRelativePath
import com.flashcardsopensourceapp.data.local.model.media.normalizeMediaSha256
import com.flashcardsopensourceapp.data.local.model.review.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewCardQueueStatus
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import com.flashcardsopensourceapp.data.local.model.review.ReviewSchedule
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilterOptions
import com.flashcardsopensourceapp.data.local.model.review.ReviewSessionQueryInputs
import com.flashcardsopensourceapp.data.local.model.review.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.review.ReviewTimelinePage
import com.flashcardsopensourceapp.data.local.model.scheduling.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceTagsSummary
import com.flashcardsopensourceapp.data.local.model.review.buildBoundedReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.review.buildReviewDeckFilterOptions
import com.flashcardsopensourceapp.data.local.model.review.buildReviewTimelinePage
import com.flashcardsopensourceapp.data.local.model.scheduling.computeReviewSchedule
import com.flashcardsopensourceapp.data.local.model.cloud.formatIsoTimestamp
import com.flashcardsopensourceapp.data.local.model.cards.isCardDue
import com.flashcardsopensourceapp.data.local.model.scheduling.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.review.matchesReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.resolveReviewFilterFromTagNames
import com.flashcardsopensourceapp.data.local.model.review.toReviewCard
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import com.flashcardsopensourceapp.data.local.review.prompts.ReviewPromptCounters
import com.flashcardsopensourceapp.data.local.review.prompts.countReviewPromptDays
import com.flashcardsopensourceapp.data.local.review.prompts.reviewPromptDayOf
import com.flashcardsopensourceapp.data.local.review.prompts.reviewPromptDayStartMillis
import com.flashcardsopensourceapp.data.local.review.prompts.reviewPromptTimeBucketMillis
import com.flashcardsopensourceapp.data.local.repository.cards.toCardSummary
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.loadCurrentWorkspaceOrNull
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.observeCurrentWorkspace
import com.flashcardsopensourceapp.data.local.repository.decks.toDeckSummary
import com.flashcardsopensourceapp.data.local.repository.progress.cache.LocalProgressCacheStore
import com.flashcardsopensourceapp.data.local.repository.shared.TimeProvider
import com.flashcardsopensourceapp.data.local.repository.workspace.makeWorkspaceTagsSummary
import com.flashcardsopensourceapp.data.local.repository.workspace.makeWorkspaceTagsSummaryFromStoredTagNames
import com.flashcardsopensourceapp.data.local.repository.workspace.toWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.io.IOException
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.time.ZoneId
import java.util.UUID

@OptIn(ExperimentalCoroutinesApi::class)
class LocalReviewRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val reviewPreferencesStore: ReviewPreferencesStore,
    private val syncLocalStore: SyncLocalStore,
    private val localProgressCacheStore: LocalProgressCacheStore,
    private val timeProvider: TimeProvider,
    private val mediaAssetFileCacheRootDirectory: File,
    private val mediaAssetDownloadUrlLoader: ReviewMediaAssetDownloadUrlLoader,
    private val mediaAssetDownloader: ReviewMediaAssetDownloader,
    private val analytics: Analytics,
    private val onFirstReviewOnboardingPersistenceFailed: (Exception) -> Unit,
    private val onFirstReviewOnboardingSaved: () -> Unit
) : ReviewRepository {
    private val mediaAssetDownloadLocksMutex = Mutex()
    private val mediaAssetDownloadLocks: MutableMap<String, Mutex> = mutableMapOf()

    override fun observeReviewSession(
        selectedFilter: ReviewFilter,
        queryInputs: Flow<ReviewSessionQueryInputs>
    ): Flow<ReviewSessionSnapshot> {
        return combine(
            observeCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore
            ),
            database.deckDao().observeDecks()
        ) { workspace, decks ->
            workspace to decks
        }.flatMapLatest { (workspace, decks) ->
            if (workspace == null) {
                return@flatMapLatest flowOf(
                    makeEmptyReviewSessionSnapshot(
                        nowMillis = System.currentTimeMillis()
                    )
                )
            }

            val workspaceId: String = workspace.workspaceId
            val decksForResolution: List<DeckSummary> = decks.filter { deck ->
                deck.workspaceId == workspaceId && deck.deletedAtMillis == null
            }.map { deck ->
                toReviewDeckSummary(
                    deck = deck,
                    dueCards = 0
                )
            }

            // One default per workspace, so a missing settings row does not make every base new.
            val defaultSettings: WorkspaceSchedulerSettings = makeDefaultWorkspaceSchedulerSettings(
                workspaceId = workspaceId,
                updatedAtMillis = System.currentTimeMillis()
            )
            combine(
                observeReviewTagNamesOffRatingPath(database = database, workspaceId = workspaceId),
                database.workspaceSchedulerSettingsDao().observeWorkspaceSchedulerSettings(
                    workspaceId = workspaceId
                )
            ) { storedTagNames, settingsEntity ->
                val resolvedFilter: ReviewFilter = resolveReviewFilterFromTagNames(
                    selectedFilter = selectedFilter,
                    decks = decksForResolution,
                    tagNames = storedTagNames
                )
                val settings: WorkspaceSchedulerSettings = settingsEntity?.let(::toWorkspaceSchedulerSettings)
                    ?: defaultSettings

                ReviewSessionQueryBase(
                    workspaceId = workspaceId,
                    resolvedFilter = resolvedFilter,
                    predicate = makeReviewQueuePredicate(
                        selectedFilter = resolvedFilter,
                        decks = decksForResolution,
                        storedTagNames = storedTagNames
                    ),
                    decksForResolution = decksForResolution,
                    storedTagNames = storedTagNames,
                    settings = settings
                )
            }.distinctUntilChanged().flatMapLatest { queryBase ->
                queryInputs.distinctUntilChanged().flatMapLatest { inputs ->
                    observeBoundedReviewSession(
                        queryBase = queryBase,
                        inputs = inputs
                    )
                }
            }
        }
    }

    private fun observeBoundedReviewSession(
        queryBase: ReviewSessionQueryBase,
        inputs: ReviewSessionQueryInputs
    ): Flow<ReviewSessionSnapshot> {
        val pendingReviewedCards: Set<PendingReviewedCard> = inputs.pendingReviewedCards
        val nowMillis: Long = inputs.nowMillis
        val queueLoadLimit: Int = reviewSessionCanonicalQueueSize +
            pendingReviewedCards.size +
            reviewSessionQueueLookaheadSize

        return combine(
            observeActiveReviewQueue(
                database = database,
                workspaceId = queryBase.workspaceId,
                nowMillis = nowMillis,
                predicate = queryBase.predicate,
                limit = queueLoadLimit
            ),
            observeReviewDueCountRow(
                database = database,
                workspaceId = queryBase.workspaceId,
                nowMillis = nowMillis,
                predicate = queryBase.predicate
            ),
            observeReviewTotalCount(
                database = database,
                workspaceId = queryBase.workspaceId,
                predicate = queryBase.predicate
            ),
            observePinnedReviewCards(
                database = database,
                workspaceId = queryBase.workspaceId,
                cardIds = listOfNotNull(inputs.presentedCardId, inputs.preparedNextCardId).distinct()
            ),
            observePendingReviewedCards(
                database = database,
                workspaceId = queryBase.workspaceId,
                pendingReviewedCards = pendingReviewedCards
            )
        ) { queueCards, dueCountRow, totalCount, pinnedCards, pendingCards ->
            val canonicalCandidates: List<CardSummary> = queueCards.map(::toCardSummary).filter { card ->
                matchesPendingReviewedCard(
                    pendingReviewedCards = pendingReviewedCards,
                    card = card
                ).not()
            }
            val canonicalCards: List<CardSummary> = canonicalCandidates.take(reviewSessionCanonicalQueueSize)
            val pendingMatchingCount: Int = pendingCards.map(::toCardSummary).count { card ->
                isPendingReviewCardCounted(
                    card = card,
                    pendingReviewedCards = pendingReviewedCards,
                    selectedFilter = queryBase.resolvedFilter,
                    decks = queryBase.decksForResolution,
                    nowMillis = nowMillis
                )
            }

            val pinnedCardSummaries: List<CardSummary> = pinnedCards.map(::toCardSummary)
            val presentedCardStillInReview: CardSummary? = resolvePinnedCardStillInReview(
                canonicalCards = canonicalCards,
                loadedPinnedCard = pinnedCardSummaries.firstOrNull { card -> card.cardId == inputs.presentedCardId },
                pinnedCardId = inputs.presentedCardId,
                pendingReviewedCards = pendingReviewedCards,
                selectedFilter = queryBase.resolvedFilter,
                decks = queryBase.decksForResolution,
                nowMillis = nowMillis
            )
            val preparedNextCardStillInReview: CardSummary? = resolvePinnedCardStillInReview(
                canonicalCards = canonicalCards,
                loadedPinnedCard = pinnedCardSummaries.firstOrNull { card -> card.cardId == inputs.preparedNextCardId },
                pinnedCardId = inputs.preparedNextCardId,
                pendingReviewedCards = pendingReviewedCards,
                selectedFilter = queryBase.resolvedFilter,
                decks = queryBase.decksForResolution,
                nowMillis = nowMillis
            )
            val presentedCard: CardSummary? = resolvePresentedCardSummary(
                canonicalCards = canonicalCards,
                presentedCardStillInReview = presentedCardStillInReview,
                presentedCardId = inputs.presentedCardId,
                preparedNextCardStillInReview = preparedNextCardStillInReview
            )

            buildBoundedReviewSessionSnapshot(
                selectedFilter = queryBase.resolvedFilter,
                decks = queryBase.decksForResolution,
                canonicalCards = canonicalCards,
                presentedCard = presentedCard,
                preparedNextCard = resolvePreparedNextCardSummary(
                    canonicalCards = canonicalCards,
                    presentedCard = presentedCard,
                    preparedNextCardStillInReview = preparedNextCardStillInReview
                ),
                dueCount = dueCountRow.dueCount,
                remainingCount = maxOf(0, dueCountRow.dueCount - pendingMatchingCount),
                totalCount = totalCount,
                hasMoreCards = canonicalCandidates.size > reviewSessionCanonicalQueueSize ||
                    queueCards.size == queueLoadLimit,
                reviewTagNames = queryBase.storedTagNames,
                nextDueAtMillis = dueCountRow.nextDueAtMillis,
                settings = queryBase.settings,
                reviewedAtMillis = nowMillis
            )
        }
    }

    override fun observeReviewFilterOptions(): Flow<ReviewFilterOptions> {
        return observeCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore
        ).map { workspace ->
            workspace?.workspaceId
        }.distinctUntilChanged().flatMapLatest { workspaceId ->
            if (workspaceId == null) {
                return@flatMapLatest flowOf(
                    ReviewFilterOptions(
                        deckFilters = emptyList(),
                        tagFilters = emptyList()
                    )
                )
            }

            val nowMillis: Long = System.currentTimeMillis()
            combine(
                database.deckDao().observeDecks(),
                database.tagDao().observeReviewTagNames(workspaceId = workspaceId),
                database.reviewCountDao().observeReviewTagDueCards(
                    workspaceId = workspaceId,
                    nowMillis = nowMillis
                )
            ) { decks, storedTagNames, tagDueCardRows ->
                val deckSummaries: List<DeckSummary> = loadReviewDeckSummaries(
                    database = database,
                    workspaceId = workspaceId,
                    deckEntities = decks.filter { deck ->
                        deck.workspaceId == workspaceId && deck.deletedAtMillis == null
                    },
                    storedTagNames = storedTagNames,
                    nowMillis = nowMillis
                )

                ReviewFilterOptions(
                    deckFilters = buildReviewDeckFilterOptions(decks = deckSummaries),
                    tagFilters = buildReviewTagFilterOptionsFromRows(
                        rows = tagDueCardRows,
                        storedTagNames = storedTagNames
                    )
                )
            }
        }
    }

    override fun observeReviewDueBadgeCount(): Flow<Int> {
        return observeCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore
        ).map { workspace ->
            workspace?.workspaceId
        }.distinctUntilChanged().flatMapLatest { workspaceId ->
            if (workspaceId == null) {
                return@flatMapLatest flowOf(0)
            }

            combine(
                reviewPreferencesStore.observeSelectedReviewFilter(workspaceId = workspaceId),
                database.deckDao().observeDecks(),
                observeReviewTagNamesOffRatingPath(database = database, workspaceId = workspaceId)
            ) { selectedFilter, decks, storedTagNames ->
                val decksForResolution: List<DeckSummary> = decks.filter { deck ->
                    deck.workspaceId == workspaceId && deck.deletedAtMillis == null
                }.map { deck ->
                    toReviewDeckSummary(
                        deck = deck,
                        dueCards = 0
                    )
                }
                makeReviewQueuePredicate(
                    selectedFilter = resolveReviewFilterFromTagNames(
                        selectedFilter = selectedFilter,
                        decks = decksForResolution,
                        tagNames = storedTagNames
                    ),
                    decks = decksForResolution,
                    storedTagNames = storedTagNames
                )
            }.distinctUntilChanged().flatMapLatest { predicate ->
                observeReviewDueBadgeCountForPredicate(
                    database = database,
                    workspaceId = workspaceId,
                    predicate = predicate
                )
            }
        }.distinctUntilChanged()
    }

    override fun observeReviewMediaAssets(): Flow<List<MediaAsset>> {
        return observeCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore
        ).flatMapLatest { workspace ->
            if (workspace == null) {
                return@flatMapLatest flowOf<List<MediaAsset>>(emptyList())
            }

            database.mediaAssetDao().observeMediaAssets(workspaceId = workspace.workspaceId).map { mediaAssets ->
                mediaAssets.map(::toMediaAsset)
            }
        }
    }

    override suspend fun loadReviewMediaAssetDownloadUrl(mediaAssetId: String): MediaAssetDownloadUrl {
        val reviewMediaAsset: ReviewMediaAssetLookup = loadActiveReviewMediaAsset(mediaAssetId = mediaAssetId)

        val downloadUrl: MediaAssetDownloadUrl = mediaAssetDownloadUrlLoader.loadMediaAssetDownloadUrl(
            workspaceId = reviewMediaAsset.workspaceId,
            mediaAssetId = reviewMediaAsset.mediaAsset.mediaAssetId
        )
        return validateReviewMediaAssetDownloadUrl(
            downloadUrl = downloadUrl,
            mediaAsset = reviewMediaAsset.mediaAsset,
            workspaceId = reviewMediaAsset.workspaceId
        )
    }

    override suspend fun loadReviewMediaAssetFile(mediaAssetId: String): ReviewMediaAssetFile {
        val reviewMediaAsset: ReviewMediaAssetLookup = loadActiveReviewMediaAsset(mediaAssetId = mediaAssetId)
        val mediaAsset: MediaAssetEntity = reviewMediaAsset.mediaAsset
        val sha256: String = normalizeMediaSha256(rawSha256 = mediaAsset.sha256)
        val downloadLock: Mutex = mediaDownloadLock(sha256 = sha256)
        val cachedFile: File? = downloadLock.withLock {
            loadUsableCachedReviewMediaFile(
                mediaAsset = mediaAsset,
                sha256 = sha256,
                nowMillis = System.currentTimeMillis()
            )
        }
        val localFile: File = cachedFile ?: run {
            // Cloud operations may materialize media while holding the cloud lock.
            // Never request source credentials while holding the SHA lock.
            val downloadUrl: MediaAssetDownloadUrl = validateReviewMediaAssetDownloadUrl(
                downloadUrl = mediaAssetDownloadUrlLoader.loadMediaAssetDownloadUrl(
                    workspaceId = reviewMediaAsset.workspaceId,
                    mediaAssetId = mediaAsset.mediaAssetId
                ),
                mediaAsset = mediaAsset,
                workspaceId = reviewMediaAsset.workspaceId
            )
            downloadLock.withLock {
                loadUsableCachedReviewMediaFile(
                    mediaAsset = mediaAsset,
                    sha256 = sha256,
                    nowMillis = System.currentTimeMillis()
                ) ?: downloadReviewMediaFile(
                    mediaAsset = mediaAsset,
                    sha256 = sha256,
                    downloadUrl = downloadUrl
                )
            }
        }

        return ReviewMediaAssetFile(
            mediaAsset = toMediaAsset(mediaAsset = mediaAsset),
            uri = Uri.fromFile(localFile).toString()
        )
    }

    private suspend fun loadActiveReviewMediaAsset(mediaAssetId: String): ReviewMediaAssetLookup {
        val normalizedMediaAssetId = mediaAssetId.trim()
        require(normalizedMediaAssetId.isNotEmpty()) {
            "Managed media download requires a media asset id."
        }

        val workspace: WorkspaceEntity = requireNotNull(
            loadCurrentWorkspaceOrNull(
                database = database,
                preferencesStore = preferencesStore
            )
        ) {
            "Managed media download requires an active workspace."
        }
        val mediaAsset: MediaAssetEntity = requireNotNull(
            database.mediaAssetDao().loadMediaAsset(mediaAssetId = normalizedMediaAssetId)
        ) {
            "Cannot load managed media asset: $normalizedMediaAssetId"
        }
        require(mediaAsset.workspaceId == workspace.workspaceId) {
            "Cannot load media asset '${mediaAsset.mediaAssetId}' from workspace '${mediaAsset.workspaceId}' " +
                "while current workspace is '${workspace.workspaceId}'."
        }
        require(mediaAsset.deletedAtMillis == null) {
            "Cannot load deleted media asset: ${mediaAsset.mediaAssetId}"
        }

        return ReviewMediaAssetLookup(
            workspaceId = workspace.workspaceId,
            mediaAsset = mediaAsset
        )
    }

    private suspend fun mediaDownloadLock(sha256: String): Mutex {
        return mediaAssetDownloadLocksMutex.withLock {
            mediaAssetDownloadLocks.getOrPut(sha256) {
                Mutex()
            }
        }
    }

    private suspend fun loadUsableCachedReviewMediaFile(
        mediaAsset: MediaAssetEntity,
        sha256: String,
        nowMillis: Long
    ): File? {
        val mediaBlobCache: MediaBlobCacheEntity = database.mediaTransferDao()
            .loadMediaBlobCache(sha256 = sha256)
            ?: return null
        validateReviewMediaBlobCache(
            mediaBlobCache = mediaBlobCache,
            mediaAsset = mediaAsset,
            sha256 = sha256
        )

        val cachedFile: File = resolveMediaBlobCacheFile(localRelativePath = mediaBlobCache.localRelativePath)
        if (isUsableCachedReviewMediaFile(
                cachedFile = cachedFile,
                mediaBlobCache = mediaBlobCache
            )
        ) {
            database.mediaTransferDao().updateMediaBlobCacheLastAccessed(
                sha256 = sha256,
                lastAccessedAtMillis = nowMillis
            )
            return cachedFile
        }

        database.mediaTransferDao().deleteMediaBlobCache(sha256 = sha256)
        deleteInvalidReviewMediaFile(cachedFile = cachedFile)
        return null
    }

    private suspend fun downloadReviewMediaFile(
        mediaAsset: MediaAssetEntity,
        sha256: String,
        downloadUrl: MediaAssetDownloadUrl
    ): File {
        val localRelativePath: String = buildMediaBlobCacheRelativePath(sha256 = sha256)
        val targetFile: File = resolveMediaBlobCacheFile(localRelativePath = localRelativePath)
        val parentDirectory: File = requireNotNull(targetFile.parentFile) {
            "Managed media cache target file must have a parent directory: ${targetFile.absolutePath}"
        }
        if (parentDirectory.exists().not() && parentDirectory.mkdirs().not()) {
            throw IOException("Cannot create managed media cache directory: ${parentDirectory.absolutePath}")
        }
        val temporaryFile = File(
            parentDirectory,
            "${targetFile.name}.download"
        )

        try {
            val downloadedMediaAsset: DownloadedReviewMediaAsset = mediaAssetDownloader.downloadMediaAsset(
                url = downloadUrl.url,
                targetFile = temporaryFile,
                expectedSizeBytes = mediaAsset.sizeBytes,
                expectedSha256 = sha256
            )
            validateDownloadedReviewMediaAsset(
                downloadedMediaAsset = downloadedMediaAsset,
                mediaAsset = mediaAsset,
                sha256 = sha256
            )
            moveReviewMediaFileIntoCacheAtomically(
                temporaryFile = temporaryFile,
                targetFile = targetFile
            )
            val nowMillis = System.currentTimeMillis()
            database.mediaTransferDao().upsertMediaBlobCache(
                mediaBlobCache = MediaBlobCacheEntity(
                    sha256 = sha256,
                    mimeType = mediaAsset.mimeType,
                    sizeBytes = mediaAsset.sizeBytes,
                    localRelativePath = localRelativePath,
                    createdAtMillis = nowMillis,
                    lastAccessedAtMillis = nowMillis,
                    sourceMediaAssetId = mediaAsset.mediaAssetId
                )
            )
            return targetFile
        } catch (error: Throwable) {
            deleteTemporaryReviewMediaFile(temporaryFile = temporaryFile, cause = error)
            throw error
        }
    }

    override suspend fun loadReviewTimelinePage(
        selectedFilter: ReviewFilter,
        pendingReviewedCards: Set<PendingReviewedCard>,
        offset: Int,
        limit: Int
    ): ReviewTimelinePage {
        val currentWorkspaceId: String? = loadCurrentWorkspaceOrNull(
            database = database,
            preferencesStore = preferencesStore
        )?.workspaceId
        val nowMillis: Long = System.currentTimeMillis()
        val cards: List<CardWithRelations> = database.cardDao().observeCardsWithRelations().first()
        val decks: List<DeckEntity> = database.deckDao().observeDecks().first()
        val cardSummaries: List<CardSummary> = cards.map(::toCardSummary).filter { card ->
            card.deletedAtMillis == null && (currentWorkspaceId == null || card.workspaceId == currentWorkspaceId)
        }
        val deckSummaries: List<DeckSummary> = decks.filter { deck ->
            deck.deletedAtMillis == null && (currentWorkspaceId == null || deck.workspaceId == currentWorkspaceId)
        }.map { deck ->
            toDeckSummary(
                deck = deck,
                cards = cardSummaries,
                nowMillis = nowMillis
            )
        }
        val tagsSummary: WorkspaceTagsSummary = if (currentWorkspaceId == null) {
            makeWorkspaceTagsSummary(cards = cardSummaries)
        } else {
            makeWorkspaceTagsSummaryFromStoredTagNames(
                tagNames = database.tagDao().loadReviewTagNames(workspaceId = currentWorkspaceId),
                totalCards = cardSummaries.size
            )
        }

        return buildReviewTimelinePage(
            selectedFilter = selectedFilter,
            pendingReviewedCards = pendingReviewedCards,
            decks = deckSummaries,
            cards = cardSummaries,
            tagsSummary = tagsSummary,
            reviewedAtMillis = nowMillis,
            offset = offset,
            limit = limit
        )
    }

    override suspend fun loadReviewPromptCounters(nowMillis: Long, zoneId: ZoneId): ReviewPromptCounters {
        val reviewLogDao = database.reviewLogDao()
        val today = reviewPromptDayOf(epochMillis = nowMillis, zoneId = zoneId)
        return ReviewPromptCounters(
            totalReviews = reviewLogDao.countReviewLogs(),
            reviewsToday = reviewLogDao.countReviewLogsBetween(
                startMillis = reviewPromptDayStartMillis(day = today, zoneId = zoneId),
                endMillis = reviewPromptDayStartMillis(day = today.plusDays(1L), zoneId = zoneId)
            ),
            reviewDays = countReviewPromptDays(
                timeBuckets = reviewLogDao.loadDistinctReviewTimeBuckets(bucketMillis = reviewPromptTimeBucketMillis),
                zoneId = zoneId
            )
        )
    }

    override suspend fun loadReviewCardForRollback(selectedFilter: ReviewFilter, cardId: String): ReviewCard? {
        val workspace: WorkspaceEntity = loadCurrentWorkspaceOrNull(
            database = database,
            preferencesStore = preferencesStore
        ) ?: return null
        val nowMillis: Long = System.currentTimeMillis()
        val card: CardWithRelations = database.cardDao().observeCardWithRelationsByWorkspace(
            cardId = cardId,
            workspaceId = workspace.workspaceId
        ).first() ?: return null
        val cardSummary: CardSummary = toCardSummary(card = card)
        if (cardSummary.deletedAtMillis != null) {
            return null
        }
        if (isCardDue(card = cardSummary, nowMillis = nowMillis).not()) {
            return null
        }

        val activeDeckEntities: List<DeckEntity> = database.deckDao().observeDecks().first().filter { deck ->
            deck.workspaceId == workspace.workspaceId && deck.deletedAtMillis == null
        }
        val storedTagNames: List<String> = database.tagDao().loadReviewTagNames(workspaceId = workspace.workspaceId)
        val decksForResolution: List<DeckSummary> = activeDeckEntities.map { deck ->
            toReviewDeckSummary(
                deck = deck,
                dueCards = 0
            )
        }
        val executableFilter: ReviewFilter = when (selectedFilter) {
            is ReviewFilter.Tags -> selectedFilter
            ReviewFilter.AllCards,
            is ReviewFilter.Deck -> {
                val resolvedFilter: ReviewFilter = resolveReviewFilterFromTagNames(
                    selectedFilter = selectedFilter,
                    decks = decksForResolution,
                    tagNames = storedTagNames
                )
                if (resolvedFilter != selectedFilter) {
                    return null
                }
                resolvedFilter
            }
        }
        if (matchesReviewFilter(
                filter = executableFilter,
                decks = decksForResolution,
                card = cardSummary
            ).not()
        ) {
            return null
        }

        return toReviewCard(
            card = cardSummary,
            queueStatus = ReviewCardQueueStatus.ACTIVE
        )
    }

    override suspend fun recordReview(cardId: String, rating: ReviewRating, reviewedAtMillis: Long) {
        preferencesStore.runWithLocalOutboxMutationAllowed {
            val onboardingOwner = preferencesStore.firstReviewOnboardingOwner()
            database.withTransaction {
                val card: CardEntity = requireNotNull(database.cardDao().loadCard(cardId = cardId)) {
                    "Cannot review missing card: $cardId"
                }
                val schedulerSettingsEntity: WorkspaceSchedulerSettingsEntity = requireNotNull(
                    database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings(
                        workspaceId = card.workspaceId
                    )
                ) {
                    "Scheduler settings are required before reviewing card: $cardId"
                }
                val cardWithRelations: CardWithRelations = requireNotNull(
                    database.cardDao().observeCardWithRelations(cardId = cardId).first()
                ) {
                    "Cannot load review card relations for card: $cardId"
                }
                val cardSummary: CardSummary = toCardSummary(cardWithRelations)
                val schedule: ReviewSchedule = computeReviewSchedule(
                    card = cardSummary,
                    settings = toWorkspaceSchedulerSettings(schedulerSettingsEntity),
                    rating = rating,
                    reviewedAtMillis = reviewedAtMillis
                )

                database.cardDao().updateCard(
                    card = card.copy(
                        dueAtMillis = schedule.dueAtMillis,
                        updatedAtMillis = reviewedAtMillis,
                        reps = schedule.reps,
                        lapses = schedule.lapses,
                        fsrsCardState = schedule.fsrsCardState,
                        fsrsStepIndex = schedule.fsrsStepIndex,
                        fsrsStability = schedule.fsrsStability,
                        fsrsDifficulty = schedule.fsrsDifficulty,
                        fsrsLastReviewedAtMillis = schedule.fsrsLastReviewedAtMillis,
                        fsrsScheduledDays = schedule.fsrsScheduledDays
                    )
                )
                val reviewLog: ReviewLogEntity = ReviewLogEntity(
                    reviewLogId = UUID.randomUUID().toString(),
                    workspaceId = card.workspaceId,
                    cardId = cardId,
                    replicaId = preferencesStore.currentCloudSettings().installationId,
                    clientEventId = UUID.randomUUID().toString(),
                    rating = rating,
                    reviewedAtMillis = reviewedAtMillis,
                    reviewedAtServerIso = formatIsoTimestamp(reviewedAtMillis),
                    reviewedTimeZone = timeProvider.currentZoneId().id
                )
                database.reviewLogDao().insertReviewLog(reviewLog = reviewLog)
                localProgressCacheStore.recordReviewInTransaction(
                    reviewLog = reviewLog,
                    updatedAtMillis = reviewedAtMillis
                )
                syncLocalStore.enqueueReviewEventAppend(reviewLog)
                syncLocalStore.enqueueCardUpsert(
                    card = card.copy(
                        dueAtMillis = schedule.dueAtMillis,
                        updatedAtMillis = reviewedAtMillis,
                        reps = schedule.reps,
                        lapses = schedule.lapses,
                        fsrsCardState = schedule.fsrsCardState,
                        fsrsStepIndex = schedule.fsrsStepIndex,
                        fsrsStability = schedule.fsrsStability,
                        fsrsDifficulty = schedule.fsrsDifficulty,
                        fsrsLastReviewedAtMillis = schedule.fsrsLastReviewedAtMillis,
                        fsrsScheduledDays = schedule.fsrsScheduledDays
                    ),
                    tags = cardSummary.tags,
                    affectsReviewSchedule = true
                )
            }
            try {
                if (preferencesStore.saveFirstReviewOnboardingCompletedForOwner(true, onboardingOwner)) {
                    analytics.track(AnalyticsEvent.FirstReviewOnboardingCompleted(FirstReviewOnboardingSource.REVIEW))
                }
                if (preferencesStore.pendingFirstReviewOnboardingEdit() != null) {
                    onFirstReviewOnboardingSaved()
                }
            } catch (error: Exception) {
                onFirstReviewOnboardingPersistenceFailed(error)
            }
        }
    }

    private fun resolveMediaBlobCacheFile(localRelativePath: String): File {
        val cacheRootDirectory = mediaAssetFileCacheRootDirectory.canonicalFile
        val cacheFile = File(cacheRootDirectory, localRelativePath).canonicalFile
        val cacheRootPath = cacheRootDirectory.path
        val cacheFilePath = cacheFile.path
        require(cacheFilePath == cacheRootPath || cacheFilePath.startsWith(prefix = "$cacheRootPath${File.separator}")) {
            "Managed media cache path escapes cache root: root='$cacheRootPath' relativePath='$localRelativePath'."
        }
        return cacheFile
    }

    private fun validateReviewMediaBlobCache(
        mediaBlobCache: MediaBlobCacheEntity,
        mediaAsset: MediaAssetEntity,
        sha256: String
    ): Unit {
        check(mediaBlobCache.sha256 == sha256) {
            "Managed media cache SHA-256 mismatch: expected '$sha256' but found '${mediaBlobCache.sha256}'."
        }
        check(mediaBlobCache.localRelativePath == buildMediaBlobCacheRelativePath(sha256 = sha256)) {
            "Managed media cache path mismatch for sha256 '$sha256': " +
                "expected '${buildMediaBlobCacheRelativePath(sha256 = sha256)}' " +
                "but found '${mediaBlobCache.localRelativePath}'."
        }
        check(mediaBlobCache.sizeBytes == mediaAsset.sizeBytes) {
            "Managed media cache size mismatch for asset '${mediaAsset.mediaAssetId}' sha256 '$sha256': " +
                "asset sizeBytes=${mediaAsset.sizeBytes} cache sizeBytes=${mediaBlobCache.sizeBytes}."
        }
    }

    private fun isUsableCachedReviewMediaFile(
        cachedFile: File,
        mediaBlobCache: MediaBlobCacheEntity
    ): Boolean {
        if (cachedFile.exists().not()) {
            return false
        }
        if (cachedFile.isFile.not()) {
            return false
        }
        return cachedFile.length() == mediaBlobCache.sizeBytes
    }

    private fun deleteInvalidReviewMediaFile(cachedFile: File): Unit {
        if (cachedFile.exists().not()) {
            return
        }
        if (cachedFile.deleteRecursively().not()) {
            throw IOException("Cannot delete invalid managed media cache file: ${cachedFile.absolutePath}")
        }
    }

    private fun validateDownloadedReviewMediaAsset(
        downloadedMediaAsset: DownloadedReviewMediaAsset,
        mediaAsset: MediaAssetEntity,
        sha256: String
    ): Unit {
        check(downloadedMediaAsset.sizeBytes == mediaAsset.sizeBytes) {
            "Managed media download size mismatch for asset '${mediaAsset.mediaAssetId}': " +
                "expected ${mediaAsset.sizeBytes} byte(s) but received ${downloadedMediaAsset.sizeBytes} byte(s)."
        }
        check(downloadedMediaAsset.sha256 == sha256) {
            "Managed media download SHA-256 mismatch for asset '${mediaAsset.mediaAssetId}': " +
                "expected '$sha256' but received '${downloadedMediaAsset.sha256}'."
        }
    }

    private fun moveReviewMediaFileIntoCacheAtomically(
        temporaryFile: File,
        targetFile: File
    ): Unit {
        if (targetFile.exists() && targetFile.deleteRecursively().not()) {
            throw IOException("Cannot replace existing managed media cache file: ${targetFile.absolutePath}")
        }

        try {
            Files.move(
                temporaryFile.toPath(),
                targetFile.toPath(),
                StandardCopyOption.ATOMIC_MOVE
            )
        } catch (error: AtomicMoveNotSupportedException) {
            throw IOException(
                "Atomic managed media cache move is not supported from temporary file " +
                    "'${temporaryFile.absolutePath}' to '${targetFile.absolutePath}'.",
                error
            )
        }
    }

    private fun deleteTemporaryReviewMediaFile(
        temporaryFile: File,
        cause: Throwable
    ): Unit {
        if (temporaryFile.exists().not()) {
            return
        }
        if (temporaryFile.delete().not()) {
            cause.addSuppressed(
                IOException("Cannot delete temporary managed media download file: ${temporaryFile.absolutePath}")
            )
        }
    }
}

private data class ReviewMediaAssetLookup(
    val workspaceId: String,
    val mediaAsset: MediaAssetEntity
)

private fun toMediaAsset(mediaAsset: MediaAssetEntity): MediaAsset {
    return MediaAsset(
        mediaAssetId = mediaAsset.mediaAssetId,
        workspaceId = mediaAsset.workspaceId,
        mimeType = mediaAsset.mimeType,
        sizeBytes = mediaAsset.sizeBytes,
        sha256 = mediaAsset.sha256,
        sourceUrl = mediaAsset.sourceUrl,
        createdAtMillis = mediaAsset.createdAtMillis,
        clientUpdatedAtMillis = mediaAsset.clientUpdatedAtMillis,
        lastModifiedByReplicaId = mediaAsset.lastModifiedByReplicaId,
        lastOperationId = mediaAsset.lastOperationId,
        updatedAtMillis = mediaAsset.updatedAtMillis,
        deletedAtMillis = mediaAsset.deletedAtMillis
    )
}

private fun validateReviewMediaAssetDownloadUrl(
    downloadUrl: MediaAssetDownloadUrl,
    mediaAsset: MediaAssetEntity,
    workspaceId: String
): MediaAssetDownloadUrl {
    val responseMediaAsset: MediaAsset = downloadUrl.mediaAsset
    check(responseMediaAsset.mediaAssetId == mediaAsset.mediaAssetId) {
        "Media asset download URL response asset mismatch: expected '${mediaAsset.mediaAssetId}' " +
            "but received '${responseMediaAsset.mediaAssetId}'."
    }
    check(responseMediaAsset.workspaceId == workspaceId) {
        "Media asset download URL response workspace mismatch for asset '${mediaAsset.mediaAssetId}': " +
            "expected '$workspaceId' but received '${responseMediaAsset.workspaceId}'."
    }
    check(responseMediaAsset.deletedAtMillis == null) {
        "Media asset download URL response returned deleted media asset '${responseMediaAsset.mediaAssetId}' " +
            "with deletedAtMillis=${responseMediaAsset.deletedAtMillis}."
    }
    return downloadUrl.copy(mediaAsset = toMediaAsset(mediaAsset = mediaAsset))
}
