package com.flashcardsopensourceapp.data.local.repository.cloudsync.guest

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.ai.GuestCloudSessionCreator
import com.flashcardsopensourceapp.data.local.cloud.PendingGuestUpgradeState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeCompletion
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.CloudIdentityTestEnvironment
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.FakeCloudRemoteGateway
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredCloudCredentials
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredGuestAiSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createSyncCardOutboxEntry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
    fun linkedStateWithMissingCredentialsMarksRecoveryAndPreservesLocalData() = runBlocking {
        val preservationState = seedCredentialRecoveryLocalData()
        val coordinator = environment.createCloudGuestSessionCoordinator(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = "user-1",
            linkedWorkspaceId = preservationState.workspaceId,
            linkedEmail = "user@example.com",
            activeWorkspaceId = preservationState.workspaceId
        )

        coordinator.reconcilePersistedCloudState()

        val recoveryState = requireNotNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState()) {
            "Expected missing linked credentials to create recovery state."
        }
        assertEquals(CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING, recoveryState.reason)
        assertEquals(CloudAccountState.LINKED, recoveryState.previousCloudState)
        assertEquals(preservationState.installationId, recoveryState.installationId)
        assertEquals("user-1", recoveryState.linkedUserId)
        assertEquals(preservationState.workspaceId, recoveryState.linkedWorkspaceId)
        assertEquals(preservationState.workspaceId, recoveryState.activeWorkspaceId)
        assertEquals("user@example.com", recoveryState.linkedEmail)
        assertEquals(CloudServiceConfigurationMode.OFFICIAL, recoveryState.configurationMode)
        assertEquals("https://api.flashcards-open-source-app.com/v1", recoveryState.apiBaseUrl)
        assertCredentialRecoveryPreservedLocalData(preservationState = preservationState)
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(preservationState.installationId, environment.cloudPreferencesStore.currentCloudSettings().installationId)
        assertEquals(preservationState.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
    }

    @Test
    fun linkedStateWithInvalidActiveWorkspaceAndMissingCredentialsMarksRecovery() = runBlocking {
        val preservationState = seedCredentialRecoveryLocalData()
        val coordinator = environment.createCloudGuestSessionCoordinator(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = "user-1",
            linkedWorkspaceId = preservationState.workspaceId,
            linkedEmail = "user@example.com",
            activeWorkspaceId = "missing-workspace"
        )

        coordinator.reconcilePersistedCloudState()

        val recoveryState = requireNotNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState()) {
            "Expected missing linked credentials to create recovery state after active workspace normalization."
        }
        assertEquals(CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING, recoveryState.reason)
        assertEquals(preservationState.workspaceId, recoveryState.linkedWorkspaceId)
        assertEquals(preservationState.workspaceId, recoveryState.activeWorkspaceId)
        assertCredentialRecoveryPreservedLocalData(preservationState = preservationState)
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(preservationState.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
    }

    @Test
    fun guestStateWithMissingSessionMarksRecoveryAndPreservesLocalData() = runBlocking {
        val preservationState = seedCredentialRecoveryLocalData()
        val coordinator = environment.createCloudGuestSessionCoordinator(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = "guest-user",
            linkedWorkspaceId = preservationState.workspaceId,
            linkedEmail = null,
            activeWorkspaceId = preservationState.workspaceId
        )

        coordinator.reconcilePersistedCloudState()

        val recoveryState = requireNotNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState()) {
            "Expected missing guest session to create recovery state."
        }
        assertEquals(CloudCredentialRecoveryReason.GUEST_SESSION_MISSING, recoveryState.reason)
        assertEquals(CloudAccountState.GUEST, recoveryState.previousCloudState)
        assertEquals(preservationState.installationId, recoveryState.installationId)
        assertEquals("guest-user", recoveryState.linkedUserId)
        assertEquals(preservationState.workspaceId, recoveryState.linkedWorkspaceId)
        assertEquals(preservationState.workspaceId, recoveryState.activeWorkspaceId)
        assertNull(recoveryState.linkedEmail)
        assertCredentialRecoveryPreservedLocalData(preservationState = preservationState)
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(preservationState.installationId, environment.cloudPreferencesStore.currentCloudSettings().installationId)
        assertEquals(preservationState.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
    }

    @Test
    fun guestStateWithInvalidActiveWorkspaceAndMissingSessionMarksRecovery() = runBlocking {
        val preservationState = seedCredentialRecoveryLocalData()
        val coordinator = environment.createCloudGuestSessionCoordinator(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = "guest-user",
            linkedWorkspaceId = preservationState.workspaceId,
            linkedEmail = null,
            activeWorkspaceId = "missing-workspace"
        )

        coordinator.reconcilePersistedCloudState()

        val recoveryState = requireNotNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState()) {
            "Expected missing guest session to create recovery state after active workspace normalization."
        }
        assertEquals(CloudCredentialRecoveryReason.GUEST_SESSION_MISSING, recoveryState.reason)
        assertEquals(preservationState.workspaceId, recoveryState.linkedWorkspaceId)
        assertEquals(preservationState.workspaceId, recoveryState.activeWorkspaceId)
        assertCredentialRecoveryPreservedLocalData(preservationState = preservationState)
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(preservationState.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
    }

    @Test
    fun activeRecoveryBlocksGuestSessionAutoCreation() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val recoveryState = CloudCredentialRecoveryState(
            reason = CloudCredentialRecoveryReason.GUEST_SESSION_MISSING,
            previousCloudState = CloudAccountState.GUEST,
            installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId,
            linkedUserId = "guest-user",
            linkedWorkspaceId = localWorkspaceId,
            activeWorkspaceId = localWorkspaceId,
            linkedEmail = null,
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            detectedAtMillis = 500L
        )
        val guestSessionCreator = RecordingGuestSessionCreator(
            session = createStoredGuestAiSession(
                workspaceId = "new-guest-workspace",
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = "new-guest-token",
                userId = "new-guest-user"
            )
        )
        val coordinator = environment.createCloudGuestSessionCoordinatorWithGuestSessionCreator(
            remoteGateway = FakeCloudRemoteGateway.standard(),
            guestSessionCreator = guestSessionCreator
        )
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(recoveryState = recoveryState)

        try {
            coordinator.ensureGuestCloudSession(workspaceId = localWorkspaceId)
            throw AssertionError("Expected active recovery to block guest session creation.")
        } catch (error: CloudCredentialRecoveryRequiredException) {
            assertEquals(recoveryState, error.recoveryState)
        }

        assertEquals(0, guestSessionCreator.createGuestSessionCalls)
        assertNull(
            environment.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun credentialRecoveryStatePersistsAcrossStoreRestart() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val recoveryState = CloudCredentialRecoveryState(
            reason = CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING,
            previousCloudState = CloudAccountState.LINKED,
            installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId,
            linkedUserId = "user-1",
            linkedWorkspaceId = localWorkspaceId,
            activeWorkspaceId = localWorkspaceId,
            linkedEmail = "user@example.com",
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            detectedAtMillis = 500L
        )
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(recoveryState = recoveryState)

        val restartedRuntime = environment.createRestartedCloudGuestSessionRuntime(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )

        assertEquals(recoveryState, restartedRuntime.cloudPreferencesStore.loadCloudCredentialRecoveryState())
    }

    @Test
    fun corruptCredentialRecoveryStateDoesNotPreventStoreRestartAndLoadsInvalidRecovery() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val metadataPreferences = environment.context.getSharedPreferences(
            "flashcards-cloud-metadata",
            Context.MODE_PRIVATE
        )
        assertTrue(
            metadataPreferences.edit()
                .putString("cloud-credential-recovery-state", "{")
                .commit()
        )

        val restartedRuntime = environment.createRestartedCloudGuestSessionRuntime(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )

        val loadedRecoveryState = requireNotNull(restartedRuntime.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        val observedRecoveryState = requireNotNull(
            restartedRuntime.cloudPreferencesStore.observeCloudCredentialRecoveryState().first()
        )
        restartedRuntime.cloudPreferencesStore.saveCredentials(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )
        restartedRuntime.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = "user-1",
            linkedWorkspaceId = localWorkspaceId,
            linkedEmail = "user@example.com",
            activeWorkspaceId = localWorkspaceId
        )

        restartedRuntime.cloudGuestSessionCoordinator.reconcilePersistedCloudState()

        assertEquals(CloudCredentialRecoveryReason.INVALID_STORED_STATE, loadedRecoveryState.reason)
        assertEquals(CloudCredentialRecoveryReason.INVALID_STORED_STATE, observedRecoveryState.reason)
        assertEquals(
            CloudCredentialRecoveryReason.INVALID_STORED_STATE,
            restartedRuntime.cloudPreferencesStore.loadCloudCredentialRecoveryState()?.reason
        )
        assertEquals("{", metadataPreferences.getString("cloud-credential-recovery-state", null))
    }

    @Test
    fun startupReconciliationResumesPendingGuestUpgradeAfterBackendCompleteBeforeLocalSwitch() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val linkedWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-linked",
            name = "Linked Workspace",
            createdAtMillis = 200L,
            isSelected = true
        )
        val accountSnapshot = createCloudAccountSnapshot(
            userId = "user-1",
            email = "user@example.com",
            workspaces = listOf(linkedWorkspace)
        )
        val credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        val guestSession = createStoredGuestAiSession(
            workspaceId = localWorkspaceId,
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            guestToken = "guest-token",
            userId = "guest-user"
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = guestSession.userId,
            linkedWorkspaceId = localWorkspaceId,
            linkedEmail = null,
            activeWorkspaceId = localWorkspaceId
        )
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = localWorkspaceId,
            session = guestSession
        )
        environment.cloudPreferencesStore.savePendingGuestUpgrade(
            pendingGuestUpgradeState = PendingGuestUpgradeState(
                configuration = makeOfficialCloudServiceConfiguration(),
                credentials = credentials,
                accountSnapshot = accountSnapshot,
                guestSession = guestSession,
                guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = linkedWorkspace.workspaceId),
                completion = CloudGuestUpgradeCompletion(
                    workspace = linkedWorkspace,
                    reconciliation = null
                )
            )
        )
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(
            recoveryState = CloudCredentialRecoveryState(
                reason = CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING,
                previousCloudState = CloudAccountState.GUEST,
                installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId,
                linkedUserId = guestSession.userId,
                linkedWorkspaceId = localWorkspaceId,
                activeWorkspaceId = localWorkspaceId,
                linkedEmail = null,
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                detectedAtMillis = 500L
            )
        )
        assertEquals(CloudAccountState.GUEST, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertNotNull(environment.database.workspaceDao().loadWorkspaceById(localWorkspaceId))
        assertNull(environment.database.workspaceDao().loadWorkspaceById(linkedWorkspace.workspaceId))
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertNotNull(environment.cloudPreferencesStore.loadPendingGuestUpgrade())
        assertNotNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())

        val restartedRuntime = environment.createRestartedCloudGuestSessionRuntime(
            remoteGateway = FakeCloudRemoteGateway.forGuestUpgrade(
                guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
                accountSnapshot = accountSnapshot,
                bootstrapRemoteIsEmpty = false,
                guestUpgradeReconciliation = null
            )
        )

        restartedRuntime.cloudGuestSessionCoordinator.reconcilePersistedCloudStateForStartup()

        assertEquals(
            CloudAccountState.LINKED,
            restartedRuntime.cloudPreferencesStore.currentCloudSettings().cloudState
        )
        assertEquals(
            linkedWorkspace.workspaceId,
            restartedRuntime.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId
        )
        assertEquals(
            linkedWorkspace.workspaceId,
            restartedRuntime.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId
        )
        assertEquals(linkedWorkspace.workspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNotNull(restartedRuntime.cloudPreferencesStore.loadCredentials())
        assertNull(restartedRuntime.cloudPreferencesStore.loadPendingGuestUpgrade())
        assertNull(restartedRuntime.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertNull(
            restartedRuntime.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun startupReconciliationResumesPendingGuestUpgradeAfterLocalShellReplacementBeforeCloudSettingsUpdate() = runBlocking {
        val guestWorkspaceId = environment.requireLocalWorkspaceId()
        val linkedWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-linked",
            name = "Linked Workspace",
            createdAtMillis = 200L,
            isSelected = true
        )
        val accountSnapshot = createCloudAccountSnapshot(
            userId = "user-1",
            email = "user@example.com",
            workspaces = listOf(linkedWorkspace)
        )
        val credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        val guestSession = createStoredGuestAiSession(
            workspaceId = guestWorkspaceId,
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            guestToken = "guest-token",
            userId = "guest-user"
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = guestSession.userId,
            linkedWorkspaceId = guestWorkspaceId,
            linkedEmail = null,
            activeWorkspaceId = guestWorkspaceId
        )
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = guestWorkspaceId,
            session = guestSession
        )
        environment.cloudPreferencesStore.savePendingGuestUpgrade(
            pendingGuestUpgradeState = PendingGuestUpgradeState(
                configuration = makeOfficialCloudServiceConfiguration(),
                credentials = credentials,
                accountSnapshot = accountSnapshot,
                guestSession = guestSession,
                guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = linkedWorkspace.workspaceId),
                completion = CloudGuestUpgradeCompletion(
                    workspace = linkedWorkspace,
                    reconciliation = null
                )
            )
        )
        val switchedWorkspace = environment.createSyncLocalStore().migrateLocalShellToLinkedWorkspace(
            workspace = linkedWorkspace,
            remoteWorkspaceIsEmpty = false
        )
        val remoteGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
            accountSnapshot = accountSnapshot,
            bootstrapRemoteIsEmpty = false,
            guestUpgradeReconciliation = null
        )

        assertEquals(linkedWorkspace.workspaceId, switchedWorkspace.workspaceId)
        assertEquals(CloudAccountState.GUEST, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(guestWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertNull(environment.database.workspaceDao().loadWorkspaceById(guestWorkspaceId))
        assertNotNull(environment.database.workspaceDao().loadWorkspaceById(linkedWorkspace.workspaceId))
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertNotNull(environment.cloudPreferencesStore.loadPendingGuestUpgrade())

        val restartedRuntime = environment.createRestartedCloudGuestSessionRuntime(
            remoteGateway = remoteGateway
        )

        restartedRuntime.cloudGuestSessionCoordinator.reconcilePersistedCloudStateForStartup()

        assertEquals(0, remoteGateway.completeGuestUpgradeCalls)
        assertEquals(listOf(linkedWorkspace.workspaceId), remoteGateway.bootstrapPullWorkspaceIds)
        assertEquals(
            CloudAccountState.LINKED,
            restartedRuntime.cloudPreferencesStore.currentCloudSettings().cloudState
        )
        assertEquals(
            linkedWorkspace.workspaceId,
            restartedRuntime.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId
        )
        assertEquals(
            linkedWorkspace.workspaceId,
            restartedRuntime.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId
        )
        assertEquals(linkedWorkspace.workspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNotNull(restartedRuntime.cloudPreferencesStore.loadCredentials())
        assertNull(restartedRuntime.cloudPreferencesStore.loadPendingGuestUpgrade())
        assertNull(
            restartedRuntime.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun startupReconciliationFailsExplicitlyWhenPendingGuestUpgradeStateIsCorrupt() = runBlocking {
        val didWriteCorruptState = environment.context.getSharedPreferences(
            "flashcards-cloud-secrets",
            Context.MODE_PRIVATE
        ).edit()
            .putString("pending-guest-upgrade", "{")
            .commit()
        assertTrue(didWriteCorruptState)
        val coordinator = environment.createCloudGuestSessionCoordinator(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )

        try {
            coordinator.reconcilePersistedCloudStateForStartup()
            throw AssertionError("Expected corrupt pending guest upgrade state to fail explicitly.")
        } catch (error: IllegalStateException) {
            assertTrue(
                error.message?.contains("Pending guest upgrade recovery state is corrupt and cannot be resumed.") == true
            )
        }
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

    private suspend fun seedCredentialRecoveryLocalData(): CredentialRecoveryPreservationState {
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

    private suspend fun assertCredentialRecoveryPreservedLocalData(
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
}

private data class CredentialRecoveryPreservationState(
    val workspaceId: String,
    val installationId: String,
    val cardId: String
)

private class RecordingGuestSessionCreator(
    private val session: StoredGuestAiSession
) : GuestCloudSessionCreator {
    var createGuestSessionCalls: Int = 0

    override suspend fun createGuestSession(
        apiBaseUrl: String,
        configurationMode: CloudServiceConfigurationMode
    ): StoredGuestAiSession {
        createGuestSessionCalls += 1
        return session
    }
}
