package com.flashcardsopensourceapp.data.local.repository.cloudsync.account.guestUpgrade

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.CloudIdentityTestEnvironment
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.FakeCloudRemoteGateway
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createOtpChallenge
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredGuestAiSession
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalCloudAccountRepositoryGuestUpgradeVerificationTest {
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
    fun verifyCodeUsesBoundGuestIdentityToCompleteCloudLink() = runBlocking {
        val localWorkspaceId: String = environment.requireLocalWorkspaceId()
        val guestWorkspaceId: String = "guest-workspace"
        val guestWorkspace: CloudWorkspaceSummary = createCloudWorkspaceSummary(
            workspaceId = guestWorkspaceId,
            name = "Guest Workspace",
            createdAtMillis = 100L,
            isSelected = true
        )
        val secondaryWorkspace: CloudWorkspaceSummary = createCloudWorkspaceSummary(
            workspaceId = "workspace-secondary",
            name = "Secondary",
            createdAtMillis = 200L,
            isSelected = false
        )
        val postBindAccountSnapshot: CloudAccountSnapshot = createCloudAccountSnapshot(
            userId = "guest-user",
            email = "user@example.com",
            workspaces = listOf(guestWorkspace, secondaryWorkspace)
        )
        val preBindAccountSnapshot: CloudAccountSnapshot = createCloudAccountSnapshot(
            userId = "cognito-user",
            email = "user@example.com",
            workspaces = listOf(
                createCloudWorkspaceSummary(
                    workspaceId = "workspace-cognito",
                    name = "Cognito Workspace",
                    createdAtMillis = 300L,
                    isSelected = true
                )
            )
        )
        val baseGateway: FakeCloudRemoteGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.BOUND,
            accountSnapshot = postBindAccountSnapshot,
            bootstrapRemoteIsEmpty = true,
            guestUpgradeReconciliation = null
        )
        val accountEvents: MutableList<String> = mutableListOf()
        var guestUpgradePrepared: Boolean = false
        val remoteGateway: CloudRemoteGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun prepareGuestUpgrade(
                apiBaseUrl: String,
                bearerToken: String,
                guestToken: String
            ): CloudGuestUpgradeMode {
                accountEvents += "prepare"
                val mode: CloudGuestUpgradeMode = baseGateway.prepareGuestUpgrade(
                    apiBaseUrl = apiBaseUrl,
                    bearerToken = bearerToken,
                    guestToken = guestToken
                )
                guestUpgradePrepared = true
                return mode
            }

            override suspend fun fetchCloudAccount(
                apiBaseUrl: String,
                authorizationHeader: String
            ): CloudAccountSnapshot {
                accountEvents += "fetch"
                if (!guestUpgradePrepared) {
                    return preBindAccountSnapshot
                }
                return baseGateway.fetchCloudAccount(
                    apiBaseUrl = apiBaseUrl,
                    authorizationHeader = authorizationHeader
                )
            }
        }
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = localWorkspaceId
        )
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = guestWorkspaceId,
            session = createStoredGuestAiSession(
                workspaceId = guestWorkspaceId,
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = "guest-token",
                userId = "guest-user"
            )
        )

        val linkContext = repository.verifyCode(
            challenge = createOtpChallenge(email = "user@example.com"),
            code = "123456"
        )

        assertEquals(listOf("prepare", "fetch"), accountEvents)
        assertEquals(postBindAccountSnapshot.userId, linkContext.userId)
        assertEquals(postBindAccountSnapshot.workspaces, linkContext.workspaces)
        assertEquals(guestWorkspaceId, linkContext.preferredWorkspaceId)
        assertEquals(CloudGuestUpgradeMode.BOUND, linkContext.guestUpgradeMode)
        assertEquals(CloudWorkspacePostAuthRoute.NONE, linkContext.postAuthRoute)
        assertEquals(CloudAccountState.GUEST, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertNull(environment.cloudPreferencesStore.currentCloudSettings().linkedUserId)
        assertNull(environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(1, baseGateway.prepareGuestUpgradeCalls)
        assertEquals(1, baseGateway.fetchCloudAccountCalls)

        val selectedWorkspace: CloudWorkspaceSummary = repository.completeCloudLink(
            linkContext = linkContext,
            selection = CloudWorkspaceLinkSelection.Existing(workspaceId = guestWorkspaceId)
        )

        assertEquals(guestWorkspace, selectedWorkspace)
        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(
            postBindAccountSnapshot.userId,
            environment.cloudPreferencesStore.currentCloudSettings().linkedUserId
        )
        assertEquals(guestWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(guestWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
    }

    @Test
    fun verifyCodeSkipsGuestUpgradeWhenStoredSessionTargetsAnotherServerConfiguration() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.BOUND,
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-remote",
                        name = "Personal",
                        createdAtMillis = 100L,
                        isSelected = true
                    )
                )
            ),
            bootstrapRemoteIsEmpty = true,
            guestUpgradeReconciliation = null
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = localWorkspaceId,
            session = createStoredGuestAiSession(
                workspaceId = "guest-workspace-stale",
                configurationMode = CloudServiceConfigurationMode.CUSTOM,
                apiBaseUrl = "https://api.stale.example.com/v1",
                guestToken = "guest-token-stale",
                userId = "guest-user-stale"
            )
        )

        val linkContext = repository.verifyCode(
            challenge = createOtpChallenge(email = "user@example.com"),
            code = "123456"
        )

        assertNull(linkContext.guestUpgradeMode)
        assertNull(
            environment.guestAiSessionStore.loadSession(
                localWorkspaceId = localWorkspaceId,
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
        assertEquals(0, remoteGateway.prepareGuestUpgradeCalls)
    }
}
