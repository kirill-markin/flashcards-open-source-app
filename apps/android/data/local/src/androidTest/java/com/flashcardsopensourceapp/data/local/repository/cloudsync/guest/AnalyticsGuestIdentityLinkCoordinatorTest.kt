package com.flashcardsopensourceapp.data.local.repository.cloudsync.guest

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.cloud.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.CloudIdentityTestEnvironment
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.FakeCloudRemoteGateway
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredGuestAiSession
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AnalyticsGuestIdentityLinkCoordinatorTest {
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
    fun analyticsGuestIdentityLinkSendsStoredGuestTokenAndClearsStoredSessions() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.standard()
        val coordinator = environment.createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        environment.prepareLinkedCloudIdentity(localWorkspaceId = localWorkspaceId)
        storeAnalyticsOnlyGuestSession(guestToken = "analytics-guest-token")

        coordinator.linkAnalyticsGuestIdentityToSignedInAccount()

        assertEquals(listOf("analytics-guest-token"), remoteGateway.linkGuestIdentityGuestTokens)
        // The account's identity row is written by the first request that loads a request context,
        // so exactly one has to precede the link or it earns `409 ACCOUNT_REQUIRED`.
        assertEquals(1, remoteGateway.fetchCloudAccountCalls)
        assertNull(
            environment.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun analyticsGuestIdentityLinkSkipsGuestSessionThatOwnsCloudData() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.standard()
        val coordinator = environment.createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        environment.prepareLinkedCloudIdentity(localWorkspaceId = localWorkspaceId)
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = null,
            session = createStoredGuestAiSession(
                workspaceId = "guest-workspace",
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = "cloud-guest-token",
                userId = "cloud-guest-user"
            )
        )

        coordinator.linkAnalyticsGuestIdentityToSignedInAccount()

        // That guest converts through `/guest-auth/upgrade/complete`, which writes the same identity
        // link; this route would revoke the session that flow still needs.
        assertTrue(remoteGateway.linkGuestIdentityGuestTokens.isEmpty())
        assertEquals(
            "cloud-guest-token",
            environment.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )?.guestToken
        )
    }

    @Test
    fun analyticsGuestIdentityLinkKeepsGuestTokenAndStopsRetryingWhenUpgradeIsRequired() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.standard()
        remoteGateway.setLinkGuestIdentityError(
            error = createCloudRemoteError(
                statusCode = 409,
                errorCode = "GUEST_IDENTITY_LINK_UPGRADE_REQUIRED",
                path = "/guest-auth/identity/link"
            )
        )
        val coordinator = environment.createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        environment.prepareLinkedCloudIdentity(localWorkspaceId = localWorkspaceId)
        storeAnalyticsOnlyGuestSession(guestToken = "analytics-guest-token")

        coordinator.linkAnalyticsGuestIdentityToSignedInAccount()

        // The token is kept: it names the owner of data only the upgrade flow can transfer.
        val retiredSession = environment.guestAiSessionStore.loadAnySession(
            configuration = makeOfficialCloudServiceConfiguration()
        )
        assertEquals("analytics-guest-token", retiredSession?.guestToken)
        assertEquals(false, retiredSession?.isAnalyticsOnly)

        coordinator.linkAnalyticsGuestIdentityToSignedInAccount()

        // Correcting the marker is what stops a link that can never succeed from being retried on
        // every app start and every sign-in.
        assertEquals(listOf("analytics-guest-token"), remoteGateway.linkGuestIdentityGuestTokens)
    }

    @Test
    fun analyticsGuestIdentityLinkDropsGuestTokenOwnedByAnotherAccount() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.standard()
        remoteGateway.setLinkGuestIdentityError(
            error = createCloudRemoteError(
                statusCode = 409,
                errorCode = "GUEST_IDENTITY_LINK_OTHER_ACCOUNT",
                path = "/guest-auth/identity/link"
            )
        )
        val coordinator = environment.createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        environment.prepareLinkedCloudIdentity(localWorkspaceId = localWorkspaceId)
        storeAnalyticsOnlyGuestSession(guestToken = "analytics-guest-token")

        coordinator.linkAnalyticsGuestIdentityToSignedInAccount()

        assertEquals(listOf("analytics-guest-token"), remoteGateway.linkGuestIdentityGuestTokens)
        // Terminal: the credential is not this install's, so it must not stay as an analytics one.
        assertNull(
            environment.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun analyticsGuestIdentityLinkKeepsGuestTokenWhenTheLinkFailsRetryably() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.standard()
        remoteGateway.setLinkGuestIdentityError(
            error = createCloudRemoteError(
                statusCode = 500,
                errorCode = null,
                path = "/guest-auth/identity/link"
            )
        )
        val coordinator = environment.createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        environment.prepareLinkedCloudIdentity(localWorkspaceId = localWorkspaceId)
        storeAnalyticsOnlyGuestSession(guestToken = "analytics-guest-token")

        try {
            coordinator.linkAnalyticsGuestIdentityToSignedInAccount()
            throw AssertionError("Expected a retryable link failure to be rethrown.")
        } catch (error: CloudRemoteException) {
            assertEquals(500, error.statusCode)
        }

        // A 5xx leaves this guest's tail unclaimed, because a success is what says the link landed,
        // so the retry is mandatory and the token has to survive for it.
        val keptSession = environment.guestAiSessionStore.loadAnySession(
            configuration = makeOfficialCloudServiceConfiguration()
        )
        assertEquals("analytics-guest-token", keptSession?.guestToken)
        assertTrue(keptSession?.isAnalyticsOnly == true)
    }

    /**
     * The credential must belong to the account this install is linked to. Linking on a mismatch
     * would attribute the guest's whole pre-sign-in tail to the wrong account, and
     * `analytics.identity_links` is first-link-wins with no repair path — while answering the
     * mismatch the way `authenticatedSession()` does would destroy local data instead.
     */
    @Test
    fun analyticsGuestIdentityLinkBailsWhenTheCredentialIsForAnotherAccount() = runBlocking {
        val preservationState = seedCredentialRecoveryLocalData(environment = environment)
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-2",
                email = "other@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = preservationState.workspaceId,
                        name = "Personal",
                        createdAtMillis = 100L,
                        isSelected = true
                    )
                )
            )
        )
        val coordinator = environment.createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        environment.prepareLinkedCloudIdentity(localWorkspaceId = preservationState.workspaceId)
        storeAnalyticsOnlyGuestSession(guestToken = "analytics-guest-token")

        coordinator.linkAnalyticsGuestIdentityToSignedInAccount()

        assertTrue(remoteGateway.linkGuestIdentityGuestTokens.isEmpty())
        assertCredentialRecoveryPreservedLocalData(
            environment = environment,
            preservationState = preservationState
        )
        assertEquals(
            "analytics-guest-token",
            environment.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )?.guestToken
        )
    }

    /**
     * The background link runs unattended on every app start and after every sign-in. A deleted
     * account must therefore never reach a destructive local reset from here: sync answers that
     * condition by preserving local data, and nothing about analytics may pre-empt it.
     */
    @Test
    fun analyticsGuestIdentityLinkPreservesLocalDataWhenTheAccountIsDeleted() = runBlocking {
        val preservationState = seedCredentialRecoveryLocalData(environment = environment)
        val remoteGateway = FakeCloudRemoteGateway.forFetchAccountError(
            fetchAccountError = createCloudRemoteError(
                statusCode = 410,
                errorCode = "ACCOUNT_DELETED",
                path = "/me"
            )
        )
        val coordinator = environment.createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        environment.prepareLinkedCloudIdentity(localWorkspaceId = preservationState.workspaceId)
        storeAnalyticsOnlyGuestSession(guestToken = "analytics-guest-token")

        coordinator.linkAnalyticsGuestIdentityToSignedInAccount()

        assertTrue(remoteGateway.linkGuestIdentityGuestTokens.isEmpty())
        assertCredentialRecoveryPreservedLocalData(
            environment = environment,
            preservationState = preservationState
        )
        assertEquals(
            preservationState.installationId,
            environment.cloudPreferencesStore.currentCloudSettings().installationId
        )
        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(
            "analytics-guest-token",
            environment.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )?.guestToken
        )
    }

    private fun storeAnalyticsOnlyGuestSession(guestToken: String) {
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = null,
            session = createStoredGuestAiSession(
                workspaceId = "analytics-guest-workspace",
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = guestToken,
                userId = "analytics-guest-user",
                isAnalyticsOnly = true
            )
        )
    }

    private fun createCloudRemoteError(
        statusCode: Int,
        errorCode: String?,
        path: String
    ): CloudRemoteException {
        return CloudRemoteException(
            message = "Cloud request failed with status $statusCode for $path",
            statusCode = statusCode,
            responseBody = JSONObject()
                .put("code", errorCode ?: JSONObject.NULL)
                .put("requestId", "request-1")
                .toString(),
            errorCode = errorCode,
            requestId = "request-1",
            syncConflict = null,
            androidObservationAlreadyCaptured = false
        )
    }
}
