package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.CloudIdentityTestEnvironment
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.FakeCloudRemoteGateway
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredCloudCredentials
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalCloudAccountRepositorySignInPreparationTest {
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
    fun prepareVerifiedSignInPrefersSelectedRemoteWorkspaceAndKeepsLocalActiveWorkspace() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "google-review@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-1",
                        name = "Personal",
                        createdAtMillis = 100L,
                        isSelected = false
                    ),
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-2",
                        name = "Personal",
                        createdAtMillis = 200L,
                        isSelected = true
                    )
                )
            )
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)

        val linkContext = repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )

        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(CloudWorkspacePostAuthRoute.NONE, linkContext.postAuthRoute)
        assertEquals("workspace-2", linkContext.preferredWorkspaceId)
        assertNull(environment.cloudPreferencesStore.loadCredentials())
    }
}
