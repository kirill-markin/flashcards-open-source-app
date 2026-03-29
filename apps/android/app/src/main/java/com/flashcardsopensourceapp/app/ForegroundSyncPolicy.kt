package com.flashcardsopensourceapp.app

import com.flashcardsopensourceapp.app.navigation.CardsDestination
import com.flashcardsopensourceapp.app.navigation.ReviewDestination
import com.flashcardsopensourceapp.app.navigation.SettingsDestination
import com.flashcardsopensourceapp.app.navigation.TopLevelDestination
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.CloudAccountState

const val fastForegroundSyncPollingIntervalMillis: Long = 15_000L
const val defaultForegroundSyncPollingIntervalMillis: Long = 60_000L

fun shouldRunForegroundSyncPolling(
    cloudState: CloudAccountState,
    accountDeletionState: AccountDeletionState,
    destination: TopLevelDestination
): Boolean {
    return cloudState == CloudAccountState.LINKED
        && accountDeletionState == AccountDeletionState.Hidden
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
