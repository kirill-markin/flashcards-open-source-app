package com.flashcardsopensourceapp.app

import com.flashcardsopensourceapp.app.navigation.CardsDestination
import com.flashcardsopensourceapp.app.navigation.ReviewDestination
import com.flashcardsopensourceapp.app.navigation.SettingsDestination
import com.flashcardsopensourceapp.app.navigation.TopLevelDestination
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.SyncStatus

const val fastForegroundSyncPollingIntervalMillis: Long = 15_000L
const val defaultForegroundSyncPollingIntervalMillis: Long = 60_000L

fun canRunForegroundAutoSync(
    cloudState: CloudAccountState,
    accountDeletionState: AccountDeletionState,
    syncStatus: SyncStatus
): Boolean {
    return cloudState == CloudAccountState.LINKED
        && accountDeletionState == AccountDeletionState.Hidden
        && syncStatus !is SyncStatus.Blocked
}

fun shouldRunForegroundSyncPolling(
    cloudState: CloudAccountState,
    accountDeletionState: AccountDeletionState,
    destination: TopLevelDestination,
    syncStatus: SyncStatus
): Boolean {
    return canRunForegroundAutoSync(
        cloudState = cloudState,
        accountDeletionState = accountDeletionState,
        syncStatus = syncStatus
    )
        && destination != SettingsDestination
}

fun foregroundSyncPollingIntervalMillis(destination: TopLevelDestination): Long {
    return if (usesFastForegroundSyncPolling(destination = destination)) {
        fastForegroundSyncPollingIntervalMillis
    } else {
        defaultForegroundSyncPollingIntervalMillis
    }
}

fun usesFastForegroundSyncPolling(destination: TopLevelDestination): Boolean {
    return destination == ReviewDestination || destination == CardsDestination
}
