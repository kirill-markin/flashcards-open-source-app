package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferencesUpdate
import com.flashcardsopensourceapp.data.local.model.sync.AnalyticsPreferenceWriteOrigin
import com.flashcardsopensourceapp.data.local.repository.ProductAnalyticsPreferencePushPendingException
import com.flashcardsopensourceapp.data.local.repository.ProductAnalyticsPreferencePushRefusedException
import com.flashcardsopensourceapp.data.local.repository.ProductAnalyticsPreferencePushUndeliverableException
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.loadProductAnalyticsGuestSessionOrNull
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal class CloudProductAnalyticsPreferenceCoordinator(
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val operationCoordinator: CloudOperationCoordinator,
    private val guestSessionStore: GuestAiSessionStore,
    private val resolveLinkedSessionLocked: suspend () -> AccountContextSession?,
    private val onProductAnalyticsPreferencePushRefused: (Int?) -> Unit
) {
    suspend fun updateEnabled(enabled: Boolean) {
        // The device must honor the answer immediately, even while sync holds the operation lock.
        preferencesStore.saveProductAnalyticsEnabledPendingPush(enabled = enabled)
        operationCoordinator.runExclusive {
            val pushFailure: Exception? = try {
                pushPendingLocked(origin = AnalyticsPreferenceWriteOrigin.USER_ACTION)
                null
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                error
            }

            // Read the store because a refresh may already have delivered or recorded a refusal.
            val failure: Exception? = answerFailureLocked(enabled = enabled, cause = pushFailure)
            if (failure != null) {
                throw failure
            }
        }
    }

    suspend fun reconcilePendingLocked() {
        try {
            pushPendingLocked(origin = AnalyticsPreferenceWriteOrigin.RECONCILIATION)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // The HTTP layer reports a failed PATCH. Keep the rest of account refresh available.
        }
    }

    private suspend fun answerFailureLocked(enabled: Boolean, cause: Exception?): Exception? {
        if (preferencesStore.currentAccountPreferences().productAnalyticsEnabled != enabled) {
            return null
        }
        if (preferencesStore.isProductAnalyticsEnabledPushRefused()) {
            return ProductAnalyticsPreferencePushRefusedException(cause = cause)
        }
        // An identity change can discard a pending opt-in without a server acknowledgement.
        if (preferencesStore.isProductAnalyticsEnabledPendingPush().not()) {
            return null
        }
        if (enabled.not() && optOutHasNoIdentity()) {
            return ProductAnalyticsPreferencePushUndeliverableException(cause = cause)
        }
        return cause ?: ProductAnalyticsPreferencePushPendingException(cause = null)
    }

    private suspend fun optOutHasNoIdentity(): Boolean {
        // Linked recovery retains the account. An opted-out device will never mint a guest for analytics.
        if (preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
            return false
        }
        if (preferencesStore.loadCloudCredentialRecoveryState()?.previousCloudState == CloudAccountState.LINKED) {
            return false
        }
        return loadAnalyticsGuestSessionOrNull() == null
    }

    private suspend fun pushPendingLocked(origin: AnalyticsPreferenceWriteOrigin) {
        if (preferencesStore.isProductAnalyticsEnabledPendingPush().not()) {
            return
        }

        val enabled: Boolean = preferencesStore.currentAccountPreferences().productAnalyticsEnabled ?: return
        val session = resolveSessionLocked() ?: return
        val updatedPreferences = try {
            remoteService.updateAccountPreferences(
                apiBaseUrl = session.apiBaseUrl,
                authorizationHeader = session.authorizationHeader,
                update = AccountPreferencesUpdate(
                    accentColor = null,
                    theme = null,
                    followSystemAppearance = null,
                    reviewReactionAnimationsEnabled = null,
                    productAnalyticsEnabled = enabled,
                    productAnalyticsEnabledOrigin = origin,
                    locale = null,
                    firstReviewOnboardingCompleted = null
                )
            )
        } catch (error: CloudRemoteException) {
            handleRefusedPushLocked(enabled = enabled, session = session, error = error)
            throw error
        }

        // Save the acknowledgement before clearing the debt so a crash can only cause a retry.
        preferencesStore.savePushedAccountPreferences(preferences = updatedPreferences)
        // Reconciliation preserves a stricter remote answer. A later user action can override it.
        val refusedAsLoosening: Boolean = origin == AnalyticsPreferenceWriteOrigin.RECONCILIATION
            && enabled
            && updatedPreferences.productAnalyticsEnabled == false
        if (refusedAsLoosening.not()) {
            // A newer toggle can persist its answer while the PATCH is in flight.
            preferencesStore.clearProductAnalyticsEnabledPendingPushIfAnswerIs(enabled = enabled)
        }
    }

    private suspend fun handleRefusedPushLocked(
        enabled: Boolean,
        session: AccountContextSession,
        error: CloudRemoteException
    ) {
        val statusCode: Int = error.statusCode ?: return
        if (statusCode !in 400..499) {
            return
        }
        if (statusCode == 401 || statusCode == 410) {
            retireRefusedAnalyticsGuestSessionLocked(session = session)
            return
        }
        if (statusCode == 403 || statusCode == 408 || statusCode == 429) {
            return
        }

        if (preferencesStore.markProductAnalyticsEnabledPushRefusedIfAnswerIs(enabled = enabled)) {
            onProductAnalyticsPreferencePushRefused(statusCode)
        }
    }

    private suspend fun retireRefusedAnalyticsGuestSessionLocked(session: AccountContextSession) {
        val guestSession: StoredGuestAiSession = loadAnalyticsGuestSessionOrNull() ?: return
        if (guestSession.isAnalyticsOnly.not()) {
            return
        }
        if (session.authorizationHeader != "Guest ${guestSession.guestToken}") {
            return
        }

        // A legacy workspace-bound session could otherwise be selected on the next retry.
        withContext(Dispatchers.IO) { guestSessionStore.clearStoredSessions() }
    }

    private suspend fun resolveSessionLocked(): AccountContextSession? {
        if (preferencesStore.loadCloudCredentialRecoveryState() != null) {
            return null
        }
        if (preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
            return resolveLinkedSessionLocked()
        }

        val guestSession: StoredGuestAiSession = loadAnalyticsGuestSessionOrNull() ?: return null
        return AccountContextSession(
            apiBaseUrl = guestSession.apiBaseUrl,
            authorizationHeader = "Guest ${guestSession.guestToken}"
        )
    }

    private suspend fun loadAnalyticsGuestSessionOrNull(): StoredGuestAiSession? {
        return loadProductAnalyticsGuestSessionOrNull(
            guestSessionStore = guestSessionStore,
            configuration = preferencesStore.currentServerConfiguration()
        )
    }
}
