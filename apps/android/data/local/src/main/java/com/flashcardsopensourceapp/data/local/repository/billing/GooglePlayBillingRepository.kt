package com.flashcardsopensourceapp.data.local.repository.billing

import com.flashcardsopensourceapp.data.local.cloud.remote.billing.CloudGoogleBillingGateway
import com.flashcardsopensourceapp.data.local.cloud.remote.billing.GooglePurchaseIntent
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlement
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.CloudGuestSessionCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.withContext

data class GoogleBillingIdentity(val apiBaseUrl: String, val userId: String)

data class GoogleBillingAccount(val identity: GoogleBillingIdentity, val obfuscatedAccountId: String)

private class GoogleBillingSession(val identity: GoogleBillingIdentity, val authorizationHeader: String)

class GoogleBillingIdentityChangedException : IllegalStateException(
    "The app account changed. Return to the purchasing account or use Restore on the current account."
)

class GooglePlayBillingRepository(
    private val preferencesStore: CloudPreferencesStore,
    remoteService: CloudRemoteGateway,
    private val billingGateway: CloudGoogleBillingGateway,
    private val operationCoordinator: CloudOperationCoordinator,
    resetCoordinator: CloudIdentityResetCoordinator,
    private val guestCoordinator: CloudGuestSessionCoordinator,
    private val syncRepository: SyncRepository
) {
    private val sessionProvider = CloudSessionProvider(
        preferencesStore = preferencesStore,
        remoteService = remoteService,
        operationCoordinator = operationCoordinator,
        resetCoordinator = resetCoordinator
    )

    fun observeIdentity(): Flow<GoogleBillingIdentity?> {
        return combine(
            preferencesStore.observeCloudSettings(),
            preferencesStore.observeServerConfiguration()
        ) { _, _ -> currentStoredIdentity() }.distinctUntilChanged()
    }

    suspend fun preparePurchase(): GoogleBillingAccount = withContext(Dispatchers.IO) {
        operationCoordinator.runExclusive {
            val session = explicitSession()
            GoogleBillingAccount(
                identity = session.identity,
                obfuscatedAccountId = billingGateway.loadGoogleBillingAccount(
                    apiBaseUrl = session.identity.apiBaseUrl,
                    authorizationHeader = session.authorizationHeader
                )
            )
        }
    }

    suspend fun prepareRestore(): GoogleBillingIdentity = withContext(Dispatchers.IO) {
        operationCoordinator.runExclusive { explicitSession().identity }
    }

    suspend fun currentIdentity(): GoogleBillingIdentity? = withContext(Dispatchers.IO) {
        operationCoordinator.runExclusive {
            requireUsableAccount()
            currentStoredIdentity()
        }
    }

    suspend fun verifyPurchase(
        identity: GoogleBillingIdentity,
        purchaseToken: String,
        intent: GooglePurchaseIntent
    ): CloudEntitlement? = withContext(Dispatchers.IO) {
        operationCoordinator.runExclusive {
            val session = existingSession() ?: throw GoogleBillingIdentityChangedException()
            if (session.identity != identity) {
                throw GoogleBillingIdentityChangedException()
            }
            billingGateway.verifyGooglePurchase(
                apiBaseUrl = session.identity.apiBaseUrl,
                authorizationHeader = session.authorizationHeader,
                purchaseToken = purchaseToken,
                intent = intent
            )
            val previousReceiptRevision = preferencesStore.currentEntitlementReceiptRevision()
            syncRepository.syncNow()
            if (currentStoredIdentity() != identity) {
                throw GoogleBillingIdentityChangedException()
            }
            if (preferencesStore.currentEntitlementReceiptRevision() == previousReceiptRevision) {
                null
            } else {
                preferencesStore.observeEntitlement().value
            }
        }
    }

    // The identity guard and launch must run in the same coordinator operation; a check before a
    // suspension would allow sign-out to replace the account before Play opens its purchase sheet.
    suspend fun withCurrentIdentity(identity: GoogleBillingIdentity, action: suspend () -> Unit) {
        operationCoordinator.runExclusive {
            requireUsableAccount()
            if (currentStoredIdentity() != identity) {
                throw GoogleBillingIdentityChangedException()
            }
            action()
        }
    }

    private suspend fun explicitSession(): GoogleBillingSession {
        existingSession()?.let { return it }
        guestCoordinator.restoreGuestCloudSessionIfNeeded(
            workspaceId = preferencesStore.currentCloudSettings().activeWorkspaceId,
            createSessionIfMissing = true
        )
        return existingSession() ?: throw GoogleBillingIdentityChangedException()
    }

    private suspend fun existingSession(): GoogleBillingSession? {
        requireUsableAccount()
        val reconciliation = guestCoordinator.reconcilePersistedCloudStateLocked()
        requireUsableAccount()
        return when (reconciliation.cloudSettings.cloudState) {
            CloudAccountState.LINKED -> {
                val session = sessionProvider.authenticatedSession()
                GoogleBillingSession(
                    identity = GoogleBillingIdentity(session.configuration.apiBaseUrl, session.accountSnapshot.userId),
                    authorizationHeader = "Bearer ${session.credentials.idToken}"
                )
            }
            CloudAccountState.GUEST -> {
                val session = requireNotNull(reconciliation.restoredGuestSession) { "Guest billing session is unavailable." }
                GoogleBillingSession(
                    identity = GoogleBillingIdentity(session.apiBaseUrl, session.userId),
                    authorizationHeader = "Guest ${session.guestToken}"
                )
            }
            CloudAccountState.DISCONNECTED -> null
            CloudAccountState.LINKING_READY -> throw GoogleBillingIdentityChangedException()
        }
    }

    private fun currentStoredIdentity(): GoogleBillingIdentity? {
        val settings = preferencesStore.currentCloudSettings()
        if (settings.cloudState != CloudAccountState.LINKED && settings.cloudState != CloudAccountState.GUEST) {
            return null
        }
        val userId = settings.linkedUserId ?: return null
        return GoogleBillingIdentity(preferencesStore.currentServerConfiguration().apiBaseUrl, userId)
    }

    private fun requireUsableAccount() {
        check(preferencesStore.currentAccountDeletionState() == AccountDeletionState.Hidden) {
            "Finish the account deletion flow before using Google Play billing."
        }
        preferencesStore.loadCloudCredentialRecoveryState()?.let { recoveryState ->
            throw CloudCredentialRecoveryRequiredException(recoveryState = recoveryState)
        }
    }
}
