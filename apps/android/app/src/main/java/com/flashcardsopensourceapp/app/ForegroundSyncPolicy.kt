package com.flashcardsopensourceapp.app

import com.flashcardsopensourceapp.app.navigation.CardsDestination
import com.flashcardsopensourceapp.app.navigation.ReviewDestination
import com.flashcardsopensourceapp.app.navigation.TopLevelDestination
import com.flashcardsopensourceapp.data.local.model.CloudAccountState

const val fastForegroundSyncPollingIntervalMillis: Long = 15_000L
const val defaultForegroundSyncPollingIntervalMillis: Long = 60_000L

fun shouldRunForegroundSyncPolling(cloudState: CloudAccountState): Boolean {
    return cloudState == CloudAccountState.LINKED
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
