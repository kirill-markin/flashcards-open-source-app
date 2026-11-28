package com.flashcardsopensourceapp.app.navigation

import com.flashcardsopensourceapp.app.notifications.AppNotificationTapRequest
import com.flashcardsopensourceapp.app.widget.ReviewWidgetTapRequest
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.LocalGuestWorkspaceMigration
import com.flashcardsopensourceapp.feature.ai.AiEntryPrefill
import com.flashcardsopensourceapp.feature.ai.AiImport
import com.flashcardsopensourceapp.feature.ai.AiImportOrigin
import com.flashcardsopensourceapp.feature.ai.input.deleteAiChatAttachmentStagedFiles
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

data class AiEntryPrefillRequest(
    val requestId: Long,
    val prefill: AiEntryPrefill,
    val catalogOrigin: CatalogAiPrefillOrigin?
)

data class CatalogAiPrefillOrigin(
    val installationId: String,
    val workspaceId: String,
    val cloudState: CloudAccountState,
    val linkedUserId: String?
) {
    fun matches(current: CatalogAiPrefillOrigin, guestMigration: LocalGuestWorkspaceMigration?): Boolean {
        if (this == current) {
            return true
        }
        if (installationId != current.installationId || current.cloudState != CloudAccountState.GUEST) {
            return false
        }

        // Accepting consent can bind a local guest to a cloud workspace in the same installation.
        return when (cloudState) {
            CloudAccountState.DISCONNECTED ->
                linkedUserId == null && (
                    workspaceId == current.workspaceId ||
                        (guestMigration?.sourceWorkspaceId == workspaceId &&
                            guestMigration.guestWorkspaceId == current.workspaceId &&
                            guestMigration.guestUserId == current.linkedUserId)
                    )
            CloudAccountState.GUEST -> workspaceId == current.workspaceId && linkedUserId == null
            CloudAccountState.LINKED, CloudAccountState.LINKING_READY -> false
        }
    }
}

internal fun CloudSettings.catalogAiPrefillOrigin(): CatalogAiPrefillOrigin? {
    val workspaceId = activeWorkspaceId ?: return null
    return CatalogAiPrefillOrigin(
        installationId = installationId,
        workspaceId = workspaceId,
        cloudState = cloudState,
        linkedUserId = linkedUserId
    )
}

data class AiCardHandoffRequest(
    val requestId: Long,
    val cardId: String,
    val frontText: String,
    val backText: String,
    val tags: List<String>
)

data class AiImportRequest(
    val requestId: Long,
    val aiImport: AiImport,
    val origin: AiImportOrigin
)

data class CardEditorRequest(
    val requestId: Long,
    val cardId: String?
)

data class ReviewFilterRequest(
    val requestId: Long,
    val reviewFilter: ReviewFilter
)

enum class ProgressNavigationTarget {
    STREAK,
    LEADERBOARD
}

data class ProgressNavigationRequest(
    val requestId: Long,
    val target: ProgressNavigationTarget
)

data class AppNotificationTapHandoffRequest(
    val requestId: Long,
    val request: AppNotificationTapRequest
)

data class ReviewWidgetTapHandoffRequest(
    val requestId: Long,
    val request: ReviewWidgetTapRequest
)

enum class LibraryNavigationTarget {
    DECKS,
    TAGS
}

data class LibraryNavigationRequest(
    val requestId: Long,
    val target: LibraryNavigationTarget
)

class AppHandoffCoordinator {
    private val nextRequestId = AtomicLong(0L)
    private val aiEntryPrefillState = MutableStateFlow<AiEntryPrefillRequest?>(value = null)
    private val aiCardHandoffState = MutableStateFlow<AiCardHandoffRequest?>(value = null)
    private val aiImportState = MutableStateFlow<AiImportRequest?>(value = null)
    private val cardEditorState = MutableStateFlow<CardEditorRequest?>(value = null)
    private val reviewFilterState = MutableStateFlow<ReviewFilterRequest?>(value = null)
    private val progressNavigationState = MutableStateFlow<ProgressNavigationRequest?>(value = null)
    private val libraryNavigationState = MutableStateFlow<LibraryNavigationRequest?>(value = null)

    fun observeAiEntryPrefill(): StateFlow<AiEntryPrefillRequest?> {
        return aiEntryPrefillState.asStateFlow()
    }

    fun observeAiCardHandoff(): StateFlow<AiCardHandoffRequest?> {
        return aiCardHandoffState.asStateFlow()
    }

    fun observeAiImport(): StateFlow<AiImportRequest?> {
        return aiImportState.asStateFlow()
    }

    fun observeCardEditor(): StateFlow<CardEditorRequest?> {
        return cardEditorState.asStateFlow()
    }

    fun observeReviewFilter(): StateFlow<ReviewFilterRequest?> {
        return reviewFilterState.asStateFlow()
    }

    fun observeProgressNavigation(): StateFlow<ProgressNavigationRequest?> {
        return progressNavigationState.asStateFlow()
    }

    fun observeLibraryNavigation(): StateFlow<LibraryNavigationRequest?> {
        return libraryNavigationState.asStateFlow()
    }

    fun requestCreateCardPrefill() {
        discardPendingAiImport()
        aiEntryPrefillState.value = AiEntryPrefillRequest(
            requestId = nextRequestId.incrementAndGet(),
            prefill = AiEntryPrefill.CreateCard,
            catalogOrigin = null
        )
    }

    internal fun requestCatalogAiPrefill(prefill: AiEntryPrefill.CatalogDeck, origin: CatalogAiPrefillOrigin) {
        aiEntryPrefillState.value = AiEntryPrefillRequest(
            requestId = nextRequestId.incrementAndGet(),
            prefill = prefill,
            catalogOrigin = origin
        )
    }

    internal fun clearCatalogAiPrefillForIdentityReset() {
        aiEntryPrefillState.update { request ->
            request.takeUnless { it?.catalogOrigin != null }
        }
    }

    fun consumeAiEntryPrefill(requestId: Long) {
        aiEntryPrefillState.update { request ->
            request.takeUnless { it?.requestId == requestId }
        }
    }

    fun requestAiCardHandoff(
        cardId: String,
        frontText: String,
        backText: String,
        tags: List<String>
    ) {
        discardPendingAiImport()
        aiCardHandoffState.value = AiCardHandoffRequest(
            requestId = nextRequestId.incrementAndGet(),
            cardId = cardId,
            frontText = frontText,
            backText = backText,
            tags = tags
        )
    }

    fun consumeAiCardHandoff(requestId: Long) {
        if (aiCardHandoffState.value?.requestId != requestId) {
            return
        }

        aiCardHandoffState.value = null
    }

    fun requestAiImport(
        aiImport: AiImport,
        origin: AiImportOrigin
    ) {
        discardPendingAiImport()
        aiEntryPrefillState.update { request ->
            request?.takeIf { it.prefill is AiEntryPrefill.CatalogDeck }
        }
        aiCardHandoffState.value = null
        aiImportState.value = AiImportRequest(
            requestId = nextRequestId.incrementAndGet(),
            aiImport = aiImport,
            origin = origin
        )
    }

    fun consumeAiImport(requestId: Long) {
        if (aiImportState.value?.requestId == requestId) {
            aiImportState.value = null
        }
    }

    fun cancelAiImport(requestId: Long) {
        if (aiImportState.value?.requestId == requestId) {
            discardPendingAiImport()
        }
    }

    private fun discardPendingAiImport() {
        val request = aiImportState.value ?: return
        aiImportState.value = null
        deleteAiChatAttachmentStagedFiles(attachments = request.aiImport.attachments)
    }

    fun requestCardEditor(cardId: String?) {
        cardEditorState.value = CardEditorRequest(
            requestId = nextRequestId.incrementAndGet(),
            cardId = cardId
        )
    }

    fun consumeCardEditor(requestId: Long) {
        if (cardEditorState.value?.requestId != requestId) {
            return
        }

        cardEditorState.value = null
    }

    fun requestReviewFilter(reviewFilter: ReviewFilter) {
        reviewFilterState.value = ReviewFilterRequest(
            requestId = nextRequestId.incrementAndGet(),
            reviewFilter = reviewFilter
        )
    }

    fun consumeReviewFilter(requestId: Long) {
        if (reviewFilterState.value?.requestId != requestId) {
            return
        }

        reviewFilterState.value = null
    }

    fun requestProgressNavigation(target: ProgressNavigationTarget) {
        progressNavigationState.value = ProgressNavigationRequest(
            requestId = nextRequestId.incrementAndGet(),
            target = target
        )
    }

    fun consumeProgressNavigation(requestId: Long) {
        if (progressNavigationState.value?.requestId != requestId) {
            return
        }

        progressNavigationState.value = null
    }

    fun requestLibraryNavigation(target: LibraryNavigationTarget) {
        libraryNavigationState.value = LibraryNavigationRequest(
            requestId = nextRequestId.incrementAndGet(),
            target = target
        )
    }

    fun consumeLibraryNavigation(requestId: Long) {
        if (libraryNavigationState.value?.requestId != requestId) {
            return
        }

        libraryNavigationState.value = null
    }
}
