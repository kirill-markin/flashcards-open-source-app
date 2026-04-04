package com.flashcardsopensourceapp.data.local

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CloudGuestSessionCoordinatorTest {
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
    fun reconcilePersistedCloudStateNormalizesLegacyLinkingReadyWithoutResettingWorkspace() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val coordinator = environment.createCloudGuestSessionCoordinator(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )
        environment.cloudPreferencesStore.saveCredentials(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKING_READY,
            linkedUserId = "user-1",
            linkedWorkspaceId = null,
            linkedEmail = "user@example.com",
            activeWorkspaceId = localWorkspaceId
        )

        coordinator.reconcilePersistedCloudState()

        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertNull(environment.cloudPreferencesStore.currentCloudSettings().linkedUserId)
        assertNull(environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertNull(environment.cloudPreferencesStore.currentCloudSettings().linkedEmail)
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(localWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
    }

    @Test
    fun guestSessionStoreClearsWorkspaceScopedSessionWhenStoredWorkspaceIdDoesNotMatchKey() {
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = "local-workspace",
            session = createStoredGuestAiSession(
                workspaceId = "remote-workspace",
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = "guest-token",
                userId = "guest-user"
            )
        )

        assertNull(
            environment.guestAiSessionStore.loadSession(
                localWorkspaceId = "local-workspace",
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
        assertNull(
            environment.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun guestSessionStoreRebindsGuestSessionToRemoteWorkspaceKeyOnly() {
        val session = createStoredGuestAiSession(
            workspaceId = "remote-workspace",
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            guestToken = "guest-token",
            userId = "guest-user"
        )
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = "local-workspace",
            session = session
        )

        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = session.workspaceId,
            session = session
        )

        assertNull(
            environment.guestAiSessionStore.loadSession(
                localWorkspaceId = "local-workspace",
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
        assertEquals(
            session.workspaceId,
            environment.guestAiSessionStore.loadSession(
                localWorkspaceId = session.workspaceId,
                configuration = makeOfficialCloudServiceConfiguration()
            )?.workspaceId
        )
    }
}
