package com.flashcardsopensourceapp.app.livesmoke.support

import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.resetInlineRawScreenStateFailureGuard
import com.flashcardsopensourceapp.app.livesmoke.flows.EphemeralWorkspaceHandle
import com.flashcardsopensourceapp.app.livesmoke.flows.createEphemeralWorkspace
import com.flashcardsopensourceapp.app.livesmoke.flows.deleteEphemeralWorkspace
import com.flashcardsopensourceapp.app.livesmoke.flows.signInWithReviewAccount
import com.flashcardsopensourceapp.data.local.model.cards.CardFilter
import com.flashcardsopensourceapp.data.local.model.cards.CardSummary
import com.flashcardsopensourceapp.data.local.model.sync.SyncStatus
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

internal fun LiveSmokeContext.withLinkedWorkspaceSession(
    reviewEmail: String,
    workspaceName: String,
    action: () -> Unit
) {
    var primaryFailure: Throwable? = null
    var ephemeralWorkspaceHandle: EphemeralWorkspaceHandle? = null

    try {
        step("sign in with the configured review account") {
            signInWithReviewAccount(reviewEmail = reviewEmail)
        }
        step("create an isolated linked workspace for this run") {
            ephemeralWorkspaceHandle = createEphemeralWorkspace(workspaceName = workspaceName)
        }
        action()
    } catch (error: Throwable) {
        primaryFailure = error
        throw error
    } finally {
        if (ephemeralWorkspaceHandle != null) {
            if (primaryFailure != null) {
                resetInlineRawScreenStateFailureGuard()
            }
            try {
                step("delete the isolated workspace") {
                    deleteEphemeralWorkspace(workspaceHandle = requireNotNull(ephemeralWorkspaceHandle))
                }
            } catch (cleanupError: Throwable) {
                if (primaryFailure != null) {
                    primaryFailure.addSuppressed(cleanupError)
                } else {
                    throw cleanupError
                }
            }
        }
    }
}

internal fun LiveSmokeContext.deleteCurrentWorkspaceCards() {
    val deletedCards: List<CardSummary> = runBlocking {
        val appGraph: AppGraph = appGraph()
        val currentCards: List<CardSummary> = appGraph.cardsRepository.observeCards(
            searchQuery = "",
            filter = CardFilter(
                tags = emptyList(),
                effort = emptyList()
            )
        ).first()
        if (currentCards.isEmpty()) {
            return@runBlocking emptyList<CardSummary>()
        }

        currentCards.forEach { card ->
            appGraph.cardsRepository.deleteCard(cardId = card.cardId)
        }
        appGraph.syncRepository.syncNow()

        val syncStatus = appGraph.syncRepository.observeSyncStatus().first()
        if (syncStatus.status != SyncStatus.Idle || syncStatus.lastErrorMessage.isNotEmpty()) {
            throw AssertionError(
                "Workspace card cleanup sync did not finish cleanly. " +
                    "Status=${syncStatus.status} " +
                    "LastError=${syncStatus.lastErrorMessage} " +
                    "CloudSettings=${currentCloudSettingsSummary()} " +
                    "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}"
            )
        }

        val remainingCards: List<CardSummary> = appGraph.cardsRepository.observeCards(
            searchQuery = "",
            filter = CardFilter(
                tags = emptyList(),
                effort = emptyList()
            )
        ).first()
        if (remainingCards.isNotEmpty()) {
            throw AssertionError(
                "Workspace card cleanup left active cards behind. " +
                    "RemainingCards=${remainingCards.map { card -> card.cardId }} " +
                    "CloudSettings=${currentCloudSettingsSummary()} " +
                    "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}"
            )
        }

        currentCards
    }

    if (deletedCards.isNotEmpty()) {
        composeRule.waitForIdle()
    }
}
