package com.flashcardsopensourceapp.feature.settings.cloud

import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudSyncConflictDetails
import com.flashcardsopensourceapp.data.local.model.sync.SyncEntityType
import com.flashcardsopensourceapp.data.local.repository.SyncBlockedException
import java.net.ProtocolException
import java.net.SocketTimeoutException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CloudExpectedFailureSupportTest {
    @Test
    fun workspaceCloudFailureTreatsTransientTransportErrorAsExpected() {
        val message = expectedWorkspaceCloudFailureMessage(
            error = SocketTimeoutException("timeout"),
            fallbackMessage = "Workspace failed"
        )

        assertEquals("Workspace failed", message)
    }

    @Test
    fun workspaceCloudFailureKeepsUnexpectedIoTechnical() {
        val message = expectedWorkspaceCloudFailureMessage(
            error = ProtocolException("bad response contract"),
            fallbackMessage = "Workspace failed"
        )

        assertNull(message)
    }

    @Test
    fun workspaceCloudFailureTreatsSyncConflictAsExpected() {
        val message = expectedWorkspaceCloudFailureMessage(
            error = makeCloudRemoteException(
                errorCode = "SYNC_WORKSPACE_FORK_REQUIRED",
                syncConflict = CloudSyncConflictDetails(
                    entityType = SyncEntityType.CARD,
                    entityId = "card-1",
                    entryIndex = null,
                    reviewEventIndex = null,
                    recoverable = true,
                    conflictingWorkspaceId = "workspace-2",
                    remoteIsEmpty = false
                )
            ),
            fallbackMessage = "Workspace failed"
        )

        assertEquals("Workspace failed", message)
    }

    @Test
    fun workspaceCloudFailureTreatsForkRequiredCodeAsExpected() {
        val message = expectedWorkspaceCloudFailureMessage(
            error = makeCloudRemoteException(
                errorCode = " sync_workspace_fork_required ",
                syncConflict = null
            ),
            fallbackMessage = "Workspace failed"
        )

        assertEquals("Workspace failed", message)
    }

    @Test
    fun workspaceCloudFailureTreatsWrappedTransientTransportErrorAsExpected() {
        val message = expectedWorkspaceCloudFailureMessage(
            error = IllegalStateException(
                "Workspace transition failed.",
                SocketTimeoutException("timeout")
            ),
            fallbackMessage = "Workspace failed"
        )

        assertEquals("Workspace failed", message)
    }

    @Test
    fun workspaceCloudFailureTreatsWrappedSyncConflictAsExpected() {
        val message = expectedWorkspaceCloudFailureMessage(
            error = IllegalStateException(
                "Workspace transition failed.",
                makeCloudRemoteException(
                    errorCode = "SYNC_WORKSPACE_FORK_REQUIRED",
                    syncConflict = CloudSyncConflictDetails(
                        entityType = SyncEntityType.DECK,
                        entityId = "deck-1",
                        entryIndex = null,
                        reviewEventIndex = null,
                        recoverable = true,
                        conflictingWorkspaceId = "workspace-2",
                        remoteIsEmpty = false
                    )
                )
            ),
            fallbackMessage = "Workspace failed"
        )

        assertEquals("Workspace failed", message)
    }

    @Test
    fun workspaceCloudFailureTreatsWrappedSyncBlockedAsExpected() {
        val message = expectedWorkspaceCloudFailureMessage(
            error = IllegalStateException(
                "Workspace transition failed.",
                SyncBlockedException(message = "technical sync blocked message", cause = null)
            ),
            fallbackMessage = "Workspace failed"
        )

        assertEquals("Workspace failed", message)
    }

    @Test
    fun agentCloudFailureTreatsTransientTransportErrorAsExpected() {
        val message = expectedAgentCloudFailureMessage(
            error = SocketTimeoutException("timeout"),
            fallbackMessage = "Agent failed"
        )

        assertEquals("Agent failed", message)
    }

    @Test
    fun agentCloudFailureKeepsUnexpectedIoTechnical() {
        val message = expectedAgentCloudFailureMessage(
            error = ProtocolException("bad response contract"),
            fallbackMessage = "Agent failed"
        )

        assertNull(message)
    }

    @Test
    fun agentCloudFailureTreatsSyncConflictAsExpected() {
        val message = expectedAgentCloudFailureMessage(
            error = makeCloudRemoteException(
                errorCode = "SYNC_WORKSPACE_FORK_REQUIRED",
                syncConflict = CloudSyncConflictDetails(
                    entityType = SyncEntityType.REVIEW_EVENT,
                    entityId = "review-1",
                    entryIndex = null,
                    reviewEventIndex = 3,
                    recoverable = true,
                    conflictingWorkspaceId = "workspace-2",
                    remoteIsEmpty = false
                )
            ),
            fallbackMessage = "Agent failed"
        )

        assertEquals("Agent failed", message)
    }

    private fun makeCloudRemoteException(
        errorCode: String,
        syncConflict: CloudSyncConflictDetails?
    ): CloudRemoteException {
        return CloudRemoteException(
            message = "Cloud request failed.",
            statusCode = 409,
            responseBody = "{\"error\":\"conflict\"}",
            errorCode = errorCode,
            requestId = "request-1",
            syncConflict = syncConflict,
            androidObservationAlreadyCaptured = false
        )
    }
}
