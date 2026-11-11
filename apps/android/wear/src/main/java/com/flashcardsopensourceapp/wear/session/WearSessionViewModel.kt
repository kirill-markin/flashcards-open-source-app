package com.flashcardsopensourceapp.wear.session

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.watch.WatchHandoffReply
import com.flashcardsopensourceapp.data.local.watch.WatchHandoffSignedInAccount
import com.flashcardsopensourceapp.data.local.watch.WatchHandoffUnsupportedContractVersionException
import com.flashcardsopensourceapp.wear.WearAppGraph
import com.flashcardsopensourceapp.wear.handoff.WearHandoffClient
import com.flashcardsopensourceapp.wear.handoff.WearHandoffPhoneUnreachableException
import com.flashcardsopensourceapp.wear.handoff.WearHandoffReplyDecodingFailedException
import com.flashcardsopensourceapp.wear.handoff.WearHandoffReplyTimedOutException
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val wearSessionLogTag: String = "WearSession"

/** The auth service's answers to a refresh token it will never accept again. */
private val rejectedRefreshTokenErrorCodes: Set<String> = setOf("REFRESH_TOKEN_FAILED", "REFRESH_TOKEN_MISSING")

sealed interface WearSessionFailureMessage {
    data object OpenPhoneApp : WearSessionFailureMessage
    data object UpdateRequired : WearSessionFailureMessage
    data class ErrorText(val text: String) : WearSessionFailureMessage
}

sealed interface WearSessionState {
    data object NotConnected : WearSessionState
    data object Connecting : WearSessionState
    data object Syncing : WearSessionState
    data object Ready : WearSessionState

    /**
     * The phone switched account or workspace while ratings made here failed to sync with a retryable
     * error; the switch completes on a retry that delivers them or when the user discards them.
     */
    data class SwitchBlocked(val unsyncedRatingCount: Int) : WearSessionState
    data class Failed(val message: WearSessionFailureMessage) : WearSessionState
}

/** How one sync ended; a switch reads it to decide whether the old outbox can still be delivered. */
sealed interface WearSyncOutcome {
    data object Succeeded : WearSyncOutcome

    /** No linked account to sync. */
    data object Skipped : WearSyncOutcome
    data class Failed(val error: Exception) : WearSyncOutcome
}

private data class WearLinkedAccount(
    val userId: String,
    val workspaceId: String
)

/**
 * The watch is its own installation with its own workspace replica, signed in only through the
 * phone's handoff and following the phone's account, workspace and Review filter.
 */
class WearSessionViewModel(
    private val appGraph: WearAppGraph,
    private val handoffClient: WearHandoffClient
) : ViewModel() {
    private val stateMutable = MutableStateFlow<WearSessionState>(WearSessionState.Connecting)
    val state: StateFlow<WearSessionState> = stateMutable.asStateFlow()
    private val isRequestingHandoffMutable = MutableStateFlow(false)
    val isRequestingHandoff: StateFlow<Boolean> = isRequestingHandoffMutable.asStateFlow()
    private val lastSuccessfulSyncAtMillisMutable = MutableStateFlow<Long?>(null)
    val lastSuccessfulSyncAtMillis: StateFlow<Long?> = lastSuccessfulSyncAtMillisMutable.asStateFlow()
    private var requestedSyncJob: Job? = null
    private var isSyncRequestedAgain: Boolean = false

    /** The phone's account a blocked switch moves to. */
    private var blockedSwitchAccount: WatchHandoffSignedInAccount? = null

    fun refreshFromPhone() {
        viewModelScope.launch {
            refreshFromPhoneNow()
        }
    }

    fun discardUnsyncedRatingsAndSwitch() {
        viewModelScope.launch {
            discardUnsyncedRatingsAndSwitchNow()
        }
    }

    /** Requests during a requested sync add one more run after it instead of queueing one each. */
    fun requestSync() {
        if (requestedSyncJob?.isActive == true) {
            isSyncRequestedAgain = true
            return
        }
        requestedSyncJob = viewModelScope.launch {
            do {
                isSyncRequestedAgain = false
                syncNow()
            } while (isSyncRequestedAgain)
        }
    }

    /** One sync at a time: the cloud operation coordinator serializes it with every other cloud operation. */
    suspend fun syncNow(): WearSyncOutcome {
        val account: WearLinkedAccount
        try {
            account = loadStoredAccount() ?: return WearSyncOutcome.Skipped
            if (isHydrated(workspaceId = account.workspaceId).not()) {
                setStateUnlessSwitchBlocked(state = WearSessionState.Syncing)
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            logWearSessionFailure(event = "watch_stored_session_load_failed", error = error)
            stateMutable.value = failedState(error = error)
            return WearSyncOutcome.Failed(error = error)
        }

        try {
            appGraph.syncRepository.syncNow()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            logWearSessionFailure(event = "watch_sync_failed", error = error)
            if (isRefreshTokenRejected(error = error)) {
                signOut(reason = "refresh_token_rejected")
                return WearSyncOutcome.Failed(error = error)
            }
            setStateUnlessSwitchBlocked(state = stateAfterSyncFailure(error = error, workspaceId = account.workspaceId))
            return WearSyncOutcome.Failed(error = error)
        }

        val accountAfterSync = try {
            loadStoredAccount()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            logWearSessionFailure(event = "watch_stored_session_load_failed", error = error)
            stateMutable.value = failedState(error = error)
            return WearSyncOutcome.Failed(error = error)
        }
        if (accountAfterSync == null) {
            // The sync ended the linked identity (an account deleted elsewhere) but kept its replica.
            signOut(reason = "sync_disconnected_account")
            return WearSyncOutcome.Succeeded
        }
        lastSuccessfulSyncAtMillisMutable.value = System.currentTimeMillis()
        setStateUnlessSwitchBlocked(state = WearSessionState.Ready)
        return WearSyncOutcome.Succeeded
    }

    /**
     * Asks the phone for its account, applies the reply and syncs. An unreachable phone keeps the
     * stored session, so the watch keeps reviewing offline.
     */
    private suspend fun refreshFromPhoneNow() {
        if (isRequestingHandoffMutable.value) {
            return
        }
        isRequestingHandoffMutable.value = true
        try {
            if (awaitStartup().not()) {
                return
            }
            val storedAccount = try {
                loadStoredAccount().also { account ->
                    if (account == null) {
                        stateMutable.value = WearSessionState.Connecting
                    } else if (stateMutable.value == WearSessionState.Connecting) {
                        stateMutable.value = storedSessionState(workspaceId = account.workspaceId)
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                logWearSessionFailure(event = "watch_stored_session_load_failed", error = error)
                stateMutable.value = failedState(error = error)
                return
            }

            val reply = try {
                handoffClient.requestHandoff()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                logWearSessionFailure(event = "watch_handoff_failed", error = error)
                // The phone's last answer stays the target of a blocked switch.
                val blockedAccount = blockedSwitchAccount
                if (blockedAccount != null) {
                    applySignedInAccountAndSync(account = blockedAccount)
                    return
                }
                if (storedAccount == null) {
                    stateMutable.value = stateForHandoffFailure(error = error)
                    return
                }
                syncNow()
                return
            }

            when (reply) {
                WatchHandoffReply.SignedOut -> {
                    // The wipe drops the outbox, so ratings made offline get one best-effort push first.
                    if ((countOutboxEntriesForDropLog() ?: 0) > 0) {
                        syncNow()
                    }
                    signOutIfLinked(reason = "phone_signed_out")
                }

                is WatchHandoffReply.SignedIn -> applySignedInAccountAndSync(account = reply.account)
            }
        } finally {
            isRequestingHandoffMutable.value = false
        }
    }

    /** Drops the ratings a blocked switch waits for and completes the switch. */
    private suspend fun discardUnsyncedRatingsAndSwitchNow() {
        val account = blockedSwitchAccount
        if (account == null) {
            refreshFromPhoneNow()
            return
        }
        if (isRequestingHandoffMutable.value) {
            return
        }
        isRequestingHandoffMutable.value = true
        try {
            try {
                linkSignedInAccount(account = account, outboxDropReason = "user_discarded_for_switch")
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                logWearSessionFailure(event = "watch_handoff_apply_failed", error = error)
                stateMutable.value = failedState(error = error)
                return
            }
            syncNow()
        } finally {
            isRequestingHandoffMutable.value = false
        }
    }

    private suspend fun applySignedInAccountAndSync(account: WatchHandoffSignedInAccount) {
        val isApplied = try {
            applySignedInAccount(account = account)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            logWearSessionFailure(event = "watch_handoff_apply_failed", error = error)
            stateMutable.value = failedState(error = error)
            return
        }
        if (isApplied) {
            syncNow()
        }
    }

    /** Returns false when the switch away from the linked workspace blocks on its unsynced ratings. */
    private suspend fun applySignedInAccount(account: WatchHandoffSignedInAccount): Boolean {
        val cloudSettings = appGraph.cloudPreferencesStore.currentCloudSettings()
        if (cloudSettings.cloudState == CloudAccountState.LINKED && cloudSettings.linkedUserId == account.linkedUserId) {
            // Same user: the phone's tokens may be newer than the stored ones, so they push the old outbox below.
            saveCredentials(credentials = account.credentials)
        }

        if (cloudSettings.cloudState == CloudAccountState.LINKED && isWearLinked(cloudSettings, account).not()) {
            // Leaving the workspace drops its outbox, so ratings made offline are pushed first, and the
            // switch waits only while a later sync could still deliver them.
            val flushOutcome = if (countOutboxEntries() > 0) syncNow() else WearSyncOutcome.Succeeded
            val pendingOutboxEntryCount = countOutboxEntries()
            if (
                pendingOutboxEntryCount > 0 &&
                flushOutcome is WearSyncOutcome.Failed &&
                isRetryableWearSyncFailure(error = flushOutcome.error)
            ) {
                Log.w(
                    wearSessionLogTag,
                    "event=watch_account_switch_deferred pendingOutboxEntries=$pendingOutboxEntryCount " +
                        "userChanged=${cloudSettings.linkedUserId != account.linkedUserId} " +
                        "error=${flushOutcome.error.message} errorType=${flushOutcome.error::class.java.name}"
                )
                blockedSwitchAccount = account
                stateMutable.value = WearSessionState.SwitchBlocked(
                    unsyncedRatingCount = countUnsyncedRatings(workspaceId = linkedWorkspaceId(cloudSettings))
                )
                return false
            }
        }

        // A rejected refresh during the flush has already signed the watch out.
        val outboxDropReason = if (appGraph.cloudPreferencesStore.currentCloudSettings().linkedUserId != account.linkedUserId) {
            "linked_user_changed"
        } else {
            "workspace_changed"
        }
        linkSignedInAccount(account = account, outboxDropReason = outboxDropReason)
        return true
    }

    /** Links the watch to the handoff account; leaving a linked workspace drops its outbox, logged with [outboxDropReason]. */
    private suspend fun linkSignedInAccount(account: WatchHandoffSignedInAccount, outboxDropReason: String) {
        val cloudSettings = appGraph.cloudPreferencesStore.currentCloudSettings()
        if (isWearLinked(cloudSettings, account)) {
            saveCredentials(credentials = account.credentials)
        } else {
            val isLinked = cloudSettings.cloudState == CloudAccountState.LINKED
            val isUserChange = isLinked && cloudSettings.linkedUserId != account.linkedUserId
            val droppedOutboxEntryCount = if (isLinked) countOutboxEntriesForDropLog() else 0
            if (isUserChange) {
                appGraph.reviewPreferencesStore.clearSelectedReviewFilter(workspaceId = linkedWorkspaceId(cloudSettings))
                appGraph.cloudAccountRepository.logout()
                Log.i(wearSessionLogTag, "event=watch_local_state_wiped reason=linked_user_changed")
                logDroppedOutboxEntries(count = droppedOutboxEntryCount, reason = outboxDropReason)
            }

            // The handoff carries no server configuration, so the link always goes to the official server.
            // The watch holds no content of its own, so the link always replaces the local replica, outbox
            // and review history included, and never uploads them into the selected workspace.
            val linkContext = appGraph.cloudAccountRepository.prepareVerifiedSignIn(credentials = account.credentials)
            appGraph.cloudAccountRepository.completeReplicaCloudLink(
                linkContext = linkContext,
                workspaceId = account.workspaceId
            )
            if (isLinked && isUserChange.not()) {
                // Same user: the installation stays, as on the phone, and the link replaced only the replica.
                appGraph.reviewPreferencesStore.clearSelectedReviewFilter(workspaceId = linkedWorkspaceId(cloudSettings))
                Log.i(wearSessionLogTag, "event=watch_workspace_changed")
                logDroppedOutboxEntries(count = droppedOutboxEntryCount, reason = outboxDropReason)
            }
            // The replica is empty until the sync after the link hydrates it.
            stateMutable.value = WearSessionState.Syncing
            Log.i(
                wearSessionLogTag,
                "event=watch_linked userId=${account.linkedUserId} workspaceId=${account.workspaceId}"
            )
        }

        appGraph.reviewPreferencesStore.saveSelectedReviewFilter(
            workspaceId = account.workspaceId,
            reviewFilter = account.reviewFilter
        )
        blockedSwitchAccount = null
        // Returning to the still-linked workspace keeps it reviewable while its sync runs.
        if (stateMutable.value is WearSessionState.SwitchBlocked) {
            stateMutable.value = storedSessionState(workspaceId = account.workspaceId)
        }
    }

    /** Skips the wipe when nothing is stored, so a watch whose phone stays signed out keeps its installation. */
    private suspend fun signOutIfLinked(reason: String) {
        try {
            val cloudSettings = appGraph.cloudPreferencesStore.currentCloudSettings()
            if (cloudSettings.cloudState == CloudAccountState.DISCONNECTED && loadStoredCredentials() == null) {
                stateMutable.value = WearSessionState.NotConnected
                return
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            logWearSessionFailure(event = "watch_stored_session_load_failed", error = error)
        }
        signOut(reason = reason)
    }

    private suspend fun signOut(reason: String) {
        try {
            val droppedOutboxEntryCount = countOutboxEntriesForDropLog()
            val cloudSettings = appGraph.cloudPreferencesStore.currentCloudSettings()
            (cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId)?.let { workspaceId ->
                appGraph.reviewPreferencesStore.clearSelectedReviewFilter(workspaceId = workspaceId)
            }
            appGraph.cloudAccountRepository.logout()
            blockedSwitchAccount = null
            logDroppedOutboxEntries(count = droppedOutboxEntryCount, reason = reason)
            stateMutable.value = WearSessionState.NotConnected
            Log.i(wearSessionLogTag, "event=watch_signed_out reason=$reason")
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            logWearSessionFailure(event = "watch_sign_out_failed", error = error)
            stateMutable.value = failedState(error = error)
        }
    }

    /** False when the local database or cloud settings could not be opened; the state then carries the error. */
    private suspend fun awaitStartup(): Boolean {
        try {
            appGraph.startup.await()
            return true
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            logWearSessionFailure(event = "watch_startup_failed", error = error)
            stateMutable.value = failedState(error = error)
            return false
        }
    }

    /** A blocked switch keeps its screen while syncs of the old workspace try to deliver its ratings. */
    private fun setStateUnlessSwitchBlocked(state: WearSessionState) {
        if (stateMutable.value is WearSessionState.SwitchBlocked) {
            return
        }
        stateMutable.value = state
    }

    /** A workspace that was hydrated before stays reviewable offline whatever the sync failure. */
    private suspend fun stateAfterSyncFailure(error: Exception, workspaceId: String): WearSessionState {
        return try {
            if (isHydrated(workspaceId = workspaceId)) WearSessionState.Ready else failedState(error = error)
        } catch (error: CancellationException) {
            throw error
        } catch (loadError: Exception) {
            logWearSessionFailure(event = "watch_stored_session_load_failed", error = loadError)
            failedState(error = error)
        }
    }

    private suspend fun storedSessionState(workspaceId: String): WearSessionState {
        return if (isHydrated(workspaceId = workspaceId)) WearSessionState.Ready else WearSessionState.Syncing
    }

    private suspend fun isHydrated(workspaceId: String): Boolean {
        return appGraph.database.syncStateDao().loadSyncState(workspaceId = workspaceId)?.hasHydratedHotState == true
    }

    private suspend fun loadStoredAccount(): WearLinkedAccount? {
        val cloudSettings = appGraph.cloudPreferencesStore.currentCloudSettings()
        if (cloudSettings.cloudState != CloudAccountState.LINKED) {
            return null
        }
        val userId = cloudSettings.linkedUserId ?: return null
        val workspaceId = cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId ?: return null
        if (loadStoredCredentials() == null) {
            return null
        }
        return WearLinkedAccount(userId = userId, workspaceId = workspaceId)
    }

    private suspend fun loadStoredCredentials(): StoredCloudCredentials? {
        return withContext(Dispatchers.IO) {
            appGraph.cloudPreferencesStore.loadCredentials()
        }
    }

    private suspend fun saveCredentials(credentials: StoredCloudCredentials) {
        appGraph.operationCoordinator.runExclusive {
            withContext(Dispatchers.IO) {
                appGraph.cloudPreferencesStore.saveCredentials(credentials)
            }
        }
    }

    private suspend fun countOutboxEntries(): Int {
        return appGraph.database.outboxDao().countOutboxEntries()
    }

    /** Null when the outbox cannot be read, so the caller still logs the drop and carries on. */
    private suspend fun countOutboxEntriesForDropLog(): Int? {
        return try {
            countOutboxEntries()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            logWearSessionFailure(event = "watch_outbox_count_failed", error = error)
            null
        }
    }

    /** A rating queues a review event and a card update, so ratings are counted by their review events. */
    private suspend fun countUnsyncedRatings(workspaceId: String): Int {
        return appGraph.database.outboxDao().loadPendingReviewEventOutboxEntries(workspaceId = workspaceId).size
    }

    companion object {
        fun factory(appGraph: WearAppGraph, handoffClient: WearHandoffClient): ViewModelProvider.Factory {
            return viewModelFactory {
                initializer {
                    WearSessionViewModel(appGraph = appGraph, handoffClient = handoffClient)
                }
            }
        }
    }
}

private fun linkedWorkspaceId(cloudSettings: CloudSettings): String {
    return requireNotNull(cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId) {
        "The linked watch has no workspace in its cloud settings."
    }
}

private fun isWearLinked(cloudSettings: CloudSettings, account: WatchHandoffSignedInAccount): Boolean {
    return cloudSettings.cloudState == CloudAccountState.LINKED &&
        cloudSettings.linkedUserId == account.linkedUserId &&
        (cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId) == account.workspaceId
}

private fun stateForHandoffFailure(error: Exception): WearSessionState {
    return when (error) {
        is WearHandoffPhoneUnreachableException, is WearHandoffReplyTimedOutException -> WearSessionState.NotConnected
        is WatchHandoffUnsupportedContractVersionException, is WearHandoffReplyDecodingFailedException ->
            WearSessionState.Failed(message = WearSessionFailureMessage.UpdateRequired)

        else -> WearSessionState.Failed(message = WearSessionFailureMessage.OpenPhoneApp)
    }
}

private fun failedState(error: Exception): WearSessionState {
    return WearSessionState.Failed(
        message = WearSessionFailureMessage.ErrorText(text = error.message ?: error::class.java.name)
    )
}

private fun Throwable.causeChain(): Sequence<Throwable> {
    return generateSequence(seed = this) { currentError -> currentError.cause }
}

/**
 * Only a failure a later sync can get past keeps a switch waiting for the old outbox; a rejection or a
 * missing or forbidden old workspace never drains it.
 */
private fun isRetryableWearSyncFailure(error: Exception): Boolean {
    return error.causeChain().any { currentError ->
        currentError is IOException ||
            (currentError is CloudRemoteException && currentError.statusCode.let { statusCode ->
                statusCode != null && (statusCode == 429 || statusCode >= 500)
            })
    }
}

private fun isRefreshTokenRejected(error: Exception): Boolean {
    return error.causeChain().any { currentError ->
        currentError is CloudRemoteException &&
            currentError.statusCode == 401 &&
            currentError.errorCode in rejectedRefreshTokenErrorCodes
    }
}

/** A null count means the outbox could not be read, so the drop is logged as unknown. */
private fun logDroppedOutboxEntries(count: Int?, reason: String) {
    if (count == 0) {
        return
    }
    Log.w(wearSessionLogTag, "event=watch_outbox_dropped count=${count ?: "unknown"} reason=$reason")
}

private fun logWearSessionFailure(event: String, error: Throwable) {
    Log.w(wearSessionLogTag, "event=$event error=${error.message} errorType=${error::class.java.name}")
}
