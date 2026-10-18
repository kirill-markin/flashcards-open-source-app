package com.flashcardsopensourceapp.data.local.repository.billing

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.PaywallStateStore
import com.flashcardsopensourceapp.data.local.cloud.paywallIdentity
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteService
import com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPaywallImpression
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPaywallState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.CloudGuestSessionCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class LocalPaywallRepository(
    private val preferencesStore: CloudPreferencesStore,
    private val store: PaywallStateStore,
    private val remoteService: CloudRemoteService,
    private val operationCoordinator: CloudOperationCoordinator,
    resetCoordinator: CloudIdentityResetCoordinator,
    private val guestCoordinator: CloudGuestSessionCoordinator
) {
    private val sessionProvider = CloudSessionProvider(preferencesStore, remoteService, operationCoordinator, resetCoordinator)

    fun updateIdentity(settings: CloudSettings) {
        store.updateIdentity(settings, preferencesStore.currentServerConfiguration().apiBaseUrl)
    }

    fun currentIdentity(): String? = paywallIdentity(
        preferencesStore.currentCloudSettings(),
        preferencesStore.currentServerConfiguration().apiBaseUrl
    )

    fun state(identity: String): CloudPaywallState = store.state(identity)

    fun recordShown(identity: String, impression: CloudPaywallImpression) {
        check(currentIdentity() == identity) { "Account changed before the paywall became visible." }
        updateIdentity(preferencesStore.currentCloudSettings())
        store.record(identity, impression)
    }

    suspend fun synchronize(): Unit = withContext(Dispatchers.IO) {
        operationCoordinator.runExclusive {
            val identity = currentIdentity() ?: return@runExclusive
            check(preferencesStore.currentAccountDeletionState() == AccountDeletionState.Hidden) {
                "Finish account deletion before synchronizing paywall state."
            }
            check(preferencesStore.loadCloudCredentialRecoveryState() == null) {
                "Recover account credentials before synchronizing paywall state."
            }
            val reconciliation = guestCoordinator.reconcilePersistedCloudStateLocked()
            val authorization = when (reconciliation.cloudSettings.cloudState) {
                CloudAccountState.LINKED -> "Bearer " + sessionProvider.authenticatedSession().credentials.idToken
                CloudAccountState.GUEST -> "Guest " + requireNotNull(reconciliation.restoredGuestSession) {
                    "Guest session is unavailable for paywall state sync."
                }.guestToken
                else -> return@runExclusive
            }
            check(currentIdentity() == identity) { "Account changed during paywall state sync." }
            updateIdentity(preferencesStore.currentCloudSettings())
            val apiBaseUrl = preferencesStore.currentServerConfiguration().apiBaseUrl
            val server = remoteService.loadPaywallState(apiBaseUrl, authorization)
            check(currentIdentity() == identity) { "Account changed while loading paywall state." }
            store.merge(identity, server, null)
            for (impression in store.pending(identity)) {
                val response = remoteService.recordPaywallShown(apiBaseUrl, authorization, impression)
                check(currentIdentity() == identity) { "Account changed while saving paywall state." }
                store.merge(identity, response, impression.presentationId)
            }
        }
    }
}
