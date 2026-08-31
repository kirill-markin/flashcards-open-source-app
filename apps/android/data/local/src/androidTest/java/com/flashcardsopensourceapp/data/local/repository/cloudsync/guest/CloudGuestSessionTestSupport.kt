package com.flashcardsopensourceapp.data.local.repository.cloudsync.guest

import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.CloudIdentityTestEnvironment
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createSyncCardOutboxEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull

internal data class CredentialRecoveryPreservationState(
    val workspaceId: String,
    val installationId: String,
    val cardId: String
)

internal suspend fun seedCredentialRecoveryLocalData(
    environment: CloudIdentityTestEnvironment
): CredentialRecoveryPreservationState {
    val workspaceId = environment.requireLocalWorkspaceId()
    val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
    val cardId = environment.seedWorkspaceData(workspaceId = workspaceId)
    val card = requireNotNull(environment.database.cardDao().loadCard(cardId = cardId)) {
        "Expected seeded card."
    }
    environment.database.outboxDao().insertOutboxEntry(
        createSyncCardOutboxEntry(
            outboxEntryId = "outbox-recovery-$workspaceId",
            workspaceId = workspaceId,
            installationId = installationId,
            card = card,
            createdAtMillis = 300L
        )
    )
    return CredentialRecoveryPreservationState(
        workspaceId = workspaceId,
        installationId = installationId,
        cardId = cardId
    )
}

internal suspend fun assertCredentialRecoveryPreservedLocalData(
    environment: CloudIdentityTestEnvironment,
    preservationState: CredentialRecoveryPreservationState
) {
    assertEquals(
        preservationState.workspaceId,
        environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId
    )
    assertEquals(1, environment.database.workspaceDao().countWorkspaces())
    assertEquals(1, environment.database.cardDao().loadCards(workspaceId = preservationState.workspaceId).count())
    assertNotNull(environment.database.cardDao().loadCard(cardId = preservationState.cardId))
    assertEquals(1, environment.database.reviewLogDao().countReviewLogs(workspaceId = preservationState.workspaceId))
    assertEquals(1, environment.database.outboxDao().countOutboxEntries())
}
