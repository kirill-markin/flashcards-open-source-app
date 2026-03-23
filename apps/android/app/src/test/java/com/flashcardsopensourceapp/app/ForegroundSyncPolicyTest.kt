package com.flashcardsopensourceapp.app

import com.flashcardsopensourceapp.app.navigation.AiDestination
import com.flashcardsopensourceapp.app.navigation.CardsDestination
import com.flashcardsopensourceapp.app.navigation.ReviewDestination
import com.flashcardsopensourceapp.app.navigation.SettingsDestination
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ForegroundSyncPolicyTest {
    @Test
    fun linkedReviewAndCardsUseFastForegroundPolling() {
        assertTrue(
            shouldRunForegroundSyncPolling(
                cloudState = CloudAccountState.LINKED,
                accountDeletionState = AccountDeletionState.Hidden
            )
        )
        assertEquals(
            fastForegroundSyncPollingIntervalMillis,
            foregroundSyncPollingIntervalMillis(destination = ReviewDestination)
        )
        assertEquals(
            fastForegroundSyncPollingIntervalMillis,
            foregroundSyncPollingIntervalMillis(destination = CardsDestination)
        )
    }

    @Test
    fun linkedAiAndSettingsUseDefaultForegroundPolling() {
        assertEquals(
            defaultForegroundSyncPollingIntervalMillis,
            foregroundSyncPollingIntervalMillis(destination = AiDestination)
        )
        assertEquals(
            defaultForegroundSyncPollingIntervalMillis,
            foregroundSyncPollingIntervalMillis(destination = SettingsDestination)
        )
    }

    @Test
    fun disconnectedGuestAndLinkingReadyDoNotRunForegroundPolling() {
        assertFalse(
            shouldRunForegroundSyncPolling(
                cloudState = CloudAccountState.DISCONNECTED,
                accountDeletionState = AccountDeletionState.Hidden
            )
        )
        assertFalse(
            shouldRunForegroundSyncPolling(
                cloudState = CloudAccountState.GUEST,
                accountDeletionState = AccountDeletionState.Hidden
            )
        )
        assertFalse(
            shouldRunForegroundSyncPolling(
                cloudState = CloudAccountState.LINKING_READY,
                accountDeletionState = AccountDeletionState.Hidden
            )
        )
        assertFalse(
            shouldRunForegroundSyncPolling(
                cloudState = CloudAccountState.LINKED,
                accountDeletionState = AccountDeletionState.InProgress
            )
        )
    }
}
