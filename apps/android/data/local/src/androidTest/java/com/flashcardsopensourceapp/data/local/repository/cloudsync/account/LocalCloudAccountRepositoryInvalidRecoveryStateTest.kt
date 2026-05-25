package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.CloudIdentityTestEnvironment
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.FakeCloudRemoteGateway
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createOtpChallenge
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredCloudCredentials
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalCloudAccountRepositoryInvalidRecoveryStateTest {
    private lateinit var environment: CloudIdentityTestEnvironment

    @Before
    fun setUp() = runBlocking {
        environment = CloudIdentityTestEnvironment.create()
    }

    @After
    fun tearDown() {
        environment.close()
    }

    @Test
    fun invalidStoredRecoveryStateBlocksPostAuthWithoutIdentitySideEffects() = runBlocking {
        val metadataPreferences = environment.context.getSharedPreferences(
            "flashcards-cloud-metadata",
            Context.MODE_PRIVATE
        )
        metadataPreferences.edit()
            .putString("cloud-credential-recovery-state", "{")
            .commit()
        val remoteGateway = FakeCloudRemoteGateway.standard()
        val restartedRuntime = environment.createRestartedCloudAccountRuntime(remoteGateway = remoteGateway)

        val loadedRecoveryState = requireNotNull(restartedRuntime.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        val observedRecoveryState = requireNotNull(
            restartedRuntime.cloudPreferencesStore.observeCloudCredentialRecoveryState().first()
        )
        val linkContext = restartedRuntime.repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )
        val otpLinkContext = restartedRuntime.repository.verifyCode(
            challenge = createOtpChallenge(email = "user@example.com"),
            code = "123456"
        )

        assertEquals(CloudCredentialRecoveryReason.INVALID_STORED_STATE, loadedRecoveryState.reason)
        assertEquals(CloudCredentialRecoveryReason.INVALID_STORED_STATE, observedRecoveryState.reason)
        assertEquals(CloudWorkspacePostAuthRoute.INVALID_STORED_STATE, linkContext.postAuthRoute)
        assertEquals(CloudWorkspacePostAuthRoute.INVALID_STORED_STATE, otpLinkContext.postAuthRoute)
        assertEquals(0, remoteGateway.fetchCloudAccountCalls)
        assertEquals(0, remoteGateway.verifyCodeCalls)
        try {
            restartedRuntime.repository.completeCloudLink(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.CreateNew
            )
            throw AssertionError("Expected invalid stored recovery to block complete-link.")
        } catch (error: CloudCredentialRecoveryRequiredException) {
            assertEquals(CloudCredentialRecoveryReason.INVALID_STORED_STATE, error.recoveryState.reason)
        }

        assertEquals(0, remoteGateway.selectWorkspaceCalls)
        assertEquals(0, remoteGateway.createWorkspaceCalls)
        assertNull(restartedRuntime.cloudPreferencesStore.loadCredentials())
        assertEquals("{", metadataPreferences.getString("cloud-credential-recovery-state", null))
    }

    @Test
    fun resetInvalidStoredRecoveryStatePreservesLocalData() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val cardId = environment.seedWorkspaceData(workspaceId = localWorkspaceId)
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = "user-linked",
            linkedWorkspaceId = localWorkspaceId,
            linkedEmail = "user@example.com",
            activeWorkspaceId = localWorkspaceId
        )
        environment.cloudPreferencesStore.saveCredentials(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )
        val metadataPreferences = environment.context.getSharedPreferences(
            "flashcards-cloud-metadata",
            Context.MODE_PRIVATE
        )
        metadataPreferences.edit()
            .putString("cloud-credential-recovery-state", "{")
            .commit()
        val restartedRuntime = environment.createRestartedCloudAccountRuntime(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )

        assertEquals(
            CloudCredentialRecoveryReason.INVALID_STORED_STATE,
            restartedRuntime.cloudPreferencesStore.loadCloudCredentialRecoveryState()?.reason
        )

        restartedRuntime.repository.resetInvalidCloudCredentialRecoveryState()

        val cloudSettings = restartedRuntime.cloudPreferencesStore.currentCloudSettings()
        assertNull(restartedRuntime.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertNull(metadataPreferences.getString("cloud-credential-recovery-state", null))
        assertEquals(CloudAccountState.DISCONNECTED, cloudSettings.cloudState)
        assertNull(cloudSettings.linkedUserId)
        assertNull(cloudSettings.linkedWorkspaceId)
        assertNull(cloudSettings.linkedEmail)
        assertEquals(localWorkspaceId, cloudSettings.activeWorkspaceId)
        assertNull(restartedRuntime.cloudPreferencesStore.loadCredentials())
        assertEquals(1, environment.database.workspaceDao().countWorkspaces())
        assertEquals(localWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertEquals(1, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).count())
        assertEquals(cardId, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).single().cardId)
    }
}
