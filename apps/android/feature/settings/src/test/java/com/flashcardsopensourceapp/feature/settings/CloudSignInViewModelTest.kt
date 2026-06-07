package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.cloud.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferences
import com.flashcardsopensourceapp.data.local.model.sync.SyncStatus
import com.flashcardsopensourceapp.data.local.model.sync.SyncStatusSnapshot
import com.flashcardsopensourceapp.data.local.model.sync.defaultAccountPreferences
import com.flashcardsopensourceapp.data.local.model.cloud.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.CloudPostAuthMode
import com.flashcardsopensourceapp.feature.settings.cloud.signIn.CloudSendCodeNavigationOutcome
import com.flashcardsopensourceapp.feature.settings.cloud.signIn.CloudSignInViewModel
import java.io.IOException
import java.util.Locale
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CloudSignInViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val strings: SettingsStringResolver = TestSettingsStringResolver()

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun lateVerifiedAttemptResultDoesNotReplaceCurrentPostAuthState() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = repository,
            syncRepository = FakeSyncRepository(),
            messageController = TransientMessageController { },
            strings = strings
        )
        val postAuthCollection = backgroundScope.async {
            viewModel.postAuthUiState.collect()
        }
        val firstCredentials = makeCredentials(idToken = "id-token-1")
        val secondCredentials = makeCredentials(idToken = "id-token-2")
        val firstLinkContext = makeLinkContext(
            credentials = firstCredentials,
            email = "first@example.com",
            workspaceId = "workspace-first",
            workspaceName = "Workspace First",
            postAuthRoute = CloudWorkspacePostAuthRoute.NONE,
            preferredWorkspaceId = "workspace-first"
        )
        val secondLinkContext = makeLinkContext(
            credentials = secondCredentials,
            email = "second@example.com",
            workspaceId = "workspace-second",
            workspaceName = "Workspace Second",
            postAuthRoute = CloudWorkspacePostAuthRoute.NONE,
            preferredWorkspaceId = "workspace-second"
        )
        val blockedFirstPrepare = CompletableDeferred<CloudWorkspaceLinkContext>()
        repository.enqueueSendCodeResult(CloudSendCodeResult.Verified(credentials = firstCredentials))
        repository.enqueuePreparedLinkContext(
            idToken = firstCredentials.idToken,
            result = blockedFirstPrepare
        )
        repository.enqueueSendCodeResult(CloudSendCodeResult.Verified(credentials = secondCredentials))
        repository.enqueuePreparedLinkContext(
            idToken = secondCredentials.idToken,
            result = CompletableDeferred(secondLinkContext)
        )

        viewModel.updateEmail("first@example.com")
        val firstSendJob = backgroundScope.async {
            viewModel.sendCode()
        }
        advanceUntilIdle()

        viewModel.updateEmail("second@example.com")
        val secondOutcome = viewModel.sendCode()
        advanceUntilIdle()

        blockedFirstPrepare.complete(firstLinkContext)
        advanceUntilIdle()

        assertEquals(CloudSendCodeNavigationOutcome.Verified, secondOutcome)
        assertEquals(CloudSendCodeNavigationOutcome.NoNavigation, firstSendJob.await())
        assertEquals(CloudPostAuthMode.READY_TO_AUTO_LINK, viewModel.postAuthUiState.value.mode)
        assertEquals("second@example.com", viewModel.postAuthUiState.value.verifiedEmail)
        assertEquals("Workspace Second", viewModel.postAuthUiState.value.pendingWorkspaceTitle)
        assertEquals("workspace-second", viewModel.postAuthUiState.value.workspaces.first().workspaceId)

        postAuthCollection.cancel()
    }

    @Test
    fun unavailablePreferredWorkspaceKeepsPostAuthChooser() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = repository,
            syncRepository = FakeSyncRepository(),
            messageController = TransientMessageController { },
            strings = strings
        )
        val postAuthCollection = backgroundScope.async {
            viewModel.postAuthUiState.collect()
        }
        val credentials = makeCredentials(idToken = "id-token-1")
        repository.enqueueSendCodeResult(CloudSendCodeResult.Verified(credentials = credentials))
        repository.enqueuePreparedLinkContext(
            idToken = credentials.idToken,
            result = CompletableDeferred(
                makeLinkContext(
                    credentials = credentials,
                    email = "person@example.com",
                    workspaceId = "workspace-remote",
                    workspaceName = "Remote",
                    postAuthRoute = CloudWorkspacePostAuthRoute.NONE,
                    preferredWorkspaceId = "workspace-recovered"
                )
            )
        )

        viewModel.updateEmail("person@example.com")
        val outcome = viewModel.sendCode()
        advanceUntilIdle()

        assertEquals(CloudSendCodeNavigationOutcome.Verified, outcome)
        assertEquals(CloudPostAuthMode.CHOOSE_WORKSPACE, viewModel.postAuthUiState.value.mode)
        assertNull(viewModel.postAuthUiState.value.pendingWorkspaceTitle)
        assertEquals(false, viewModel.postAuthUiState.value.workspaces.first().isSelected)

        postAuthCollection.cancel()
    }

    @Test
    fun guestLocalRecoveryAutoCreatesNewWorkspaceAndCompletes() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        val syncRepository = FakeSyncRepository()
        val messages = mutableListOf<String>()
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = repository,
            syncRepository = syncRepository,
            messageController = TransientMessageController { message -> messages += message },
            strings = strings
        )
        val postAuthCollection = backgroundScope.async {
            viewModel.postAuthUiState.collect()
        }
        val credentials = makeCredentials(idToken = "id-token-guest-recovery")
        val recoveryWorkspace = CompletableDeferred<CloudWorkspaceSummary>()
        repository.enqueueCompleteCloudLinkResult(result = recoveryWorkspace)
        repository.enqueueSendCodeResult(CloudSendCodeResult.Verified(credentials = credentials))
        repository.enqueuePreparedLinkContext(
            idToken = credentials.idToken,
            result = CompletableDeferred(
                makeLinkContext(
                    credentials = credentials,
                    email = "person@example.com",
                    workspaceId = "workspace-remote",
                    workspaceName = "Remote",
                    postAuthRoute = CloudWorkspacePostAuthRoute.GUEST_LOCAL_RECOVERY,
                    preferredWorkspaceId = "workspace-remote"
                )
            )
        )

        viewModel.updateEmail("person@example.com")
        val outcome = viewModel.sendCode()
        advanceUntilIdle()

        assertEquals(CloudSendCodeNavigationOutcome.Verified, outcome)
        assertEquals(CloudPostAuthMode.READY_TO_AUTO_LINK, viewModel.postAuthUiState.value.mode)
        assertEquals(true, viewModel.postAuthUiState.value.isGuestLocalRecovery)
        assertNull(viewModel.postAuthUiState.value.pendingWorkspaceTitle)
        assertEquals(0, viewModel.postAuthUiState.value.workspaces.size)
        assertEquals(false, viewModel.postAuthUiState.value.canRetry)
        assertEquals(false, viewModel.postAuthUiState.value.canLogout)

        val completionJob = async {
            viewModel.completePendingPostAuthIfNeeded()
        }
        advanceUntilIdle()

        assertEquals(CloudPostAuthMode.PROCESSING, viewModel.postAuthUiState.value.mode)
        assertEquals("Recovering local data", viewModel.postAuthUiState.value.processingTitle)
        assertEquals(
            "Keep this screen open while Android reconnects preserved local data to your recovered workspace.",
            viewModel.postAuthUiState.value.processingMessage
        )
        assertEquals(listOf(CloudWorkspaceLinkSelection.CreateNew), repository.completeCloudLinkSelections)
        assertEquals(0, syncRepository.syncNowCalls)

        recoveryWorkspace.complete(
            CloudWorkspaceSummary(
                workspaceId = "workspace-new",
                name = "Personal",
                createdAtMillis = 200L,
                isSelected = true
            )
        )
        advanceUntilIdle()

        completionJob.await()
        advanceUntilIdle()
        assertEquals(listOf(CloudWorkspaceLinkSelection.CreateNew), repository.completeCloudLinkSelections)
        assertEquals(0, syncRepository.syncNowCalls)
        assertEquals(CloudPostAuthMode.IDLE, viewModel.postAuthUiState.value.mode)
        assertNotNull(viewModel.postAuthUiState.value.completionToken)
        assertEquals("Signed in and synced Personal.", messages.single())

        postAuthCollection.cancel()
    }

    @Test
    fun guestLocalRecoveryTransientFailureRetriesWithoutLogoutOrReset() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        repository.enqueueCompleteCloudLinkError(IllegalStateException("Temporary recovery failure."))
        val syncRepository = FakeSyncRepository()
        val messages = mutableListOf<String>()
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = repository,
            syncRepository = syncRepository,
            messageController = TransientMessageController { message -> messages += message },
            strings = strings
        )
        val postAuthCollection = backgroundScope.async {
            viewModel.postAuthUiState.collect()
        }
        val credentials = makeCredentials(idToken = "id-token-guest-recovery-retry")
        repository.enqueueSendCodeResult(CloudSendCodeResult.Verified(credentials = credentials))
        repository.enqueuePreparedLinkContext(
            idToken = credentials.idToken,
            result = CompletableDeferred(
                makeLinkContext(
                    credentials = credentials,
                    email = "person@example.com",
                    workspaceId = "workspace-remote",
                    workspaceName = "Remote",
                    postAuthRoute = CloudWorkspacePostAuthRoute.GUEST_LOCAL_RECOVERY,
                    preferredWorkspaceId = "workspace-remote"
                )
            )
        )

        viewModel.updateEmail("person@example.com")
        assertEquals(CloudSendCodeNavigationOutcome.Verified, viewModel.sendCode())
        advanceUntilIdle()
        viewModel.completePendingPostAuthIfNeeded()
        advanceUntilIdle()

        assertEquals(CloudPostAuthMode.FAILED, viewModel.postAuthUiState.value.mode)
        assertEquals("Temporary recovery failure.", viewModel.postAuthUiState.value.errorMessage)
        assertEquals(true, viewModel.postAuthUiState.value.isGuestLocalRecovery)
        assertEquals(true, viewModel.postAuthUiState.value.canRetry)
        assertEquals(false, viewModel.postAuthUiState.value.canLogout)
        assertEquals(listOf(CloudWorkspaceLinkSelection.CreateNew), repository.completeCloudLinkSelections)

        viewModel.retryPostAuth()
        advanceUntilIdle()

        assertEquals(
            listOf(CloudWorkspaceLinkSelection.CreateNew, CloudWorkspaceLinkSelection.CreateNew),
            repository.completeCloudLinkSelections
        )
        assertEquals(0, syncRepository.syncNowCalls)
        assertEquals(0, repository.logoutCalls)
        assertEquals(0, repository.resetInvalidCloudCredentialRecoveryStateCalls)
        assertEquals(CloudPostAuthMode.IDLE, viewModel.postAuthUiState.value.mode)
        assertEquals("Signed in and synced Personal.", messages.single())

        postAuthCollection.cancel()
    }

    @Test
    fun invalidStoredRecoveryShowsResetActionWithoutRetry() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = repository,
            syncRepository = FakeSyncRepository(),
            messageController = TransientMessageController { },
            strings = strings
        )
        val postAuthCollection = backgroundScope.async {
            viewModel.postAuthUiState.collect()
        }
        val credentials = makeCredentials(idToken = "id-token-invalid-recovery")
        repository.enqueueSendCodeResult(CloudSendCodeResult.Verified(credentials = credentials))
        repository.enqueuePreparedLinkContext(
            idToken = credentials.idToken,
            result = CompletableDeferred(
                makeLinkContext(
                    credentials = credentials,
                    email = "person@example.com",
                    workspaceId = "workspace-remote",
                    workspaceName = "Remote",
                    postAuthRoute = CloudWorkspacePostAuthRoute.INVALID_STORED_STATE,
                    preferredWorkspaceId = "workspace-remote"
                )
            )
        )

        viewModel.updateEmail("person@example.com")
        val outcome = viewModel.sendCode()
        advanceUntilIdle()

        assertEquals(CloudSendCodeNavigationOutcome.Verified, outcome)
        assertEquals(CloudPostAuthMode.FAILED, viewModel.postAuthUiState.value.mode)
        assertEquals(
            "Cloud recovery data on this device is invalid. Reset cloud identity or sign in again after clearing recovery.",
            viewModel.postAuthUiState.value.errorMessage
        )
        assertEquals(false, viewModel.postAuthUiState.value.canRetry)
        assertEquals(true, viewModel.postAuthUiState.value.canLogout)
        assertEquals("Reset cloud identity", viewModel.postAuthUiState.value.failureActionLabel)

        postAuthCollection.cancel()
    }

    @Test
    fun invalidStoredRecoveryFailureActionResetsRecoveryWithoutLogout() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        val messages = mutableListOf<String>()
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = repository,
            syncRepository = FakeSyncRepository(),
            messageController = TransientMessageController { message -> messages.add(message) },
            strings = strings
        )
        val postAuthCollection = backgroundScope.async {
            viewModel.postAuthUiState.collect()
        }
        val credentials = makeCredentials(idToken = "id-token-invalid-recovery-reset")
        repository.enqueueSendCodeResult(CloudSendCodeResult.Verified(credentials = credentials))
        repository.enqueuePreparedLinkContext(
            idToken = credentials.idToken,
            result = CompletableDeferred(
                makeLinkContext(
                    credentials = credentials,
                    email = "person@example.com",
                    workspaceId = "workspace-remote",
                    workspaceName = "Remote",
                    postAuthRoute = CloudWorkspacePostAuthRoute.INVALID_STORED_STATE,
                    preferredWorkspaceId = "workspace-remote"
                )
            )
        )

        viewModel.updateEmail("person@example.com")
        viewModel.sendCode()
        advanceUntilIdle()
        viewModel.runPostAuthFailureAction()
        advanceUntilIdle()
        viewModel.runPostAuthFailureAction()
        advanceUntilIdle()

        assertEquals(1, repository.resetInvalidCloudCredentialRecoveryStateCalls)
        assertEquals(0, repository.logoutCalls)
        assertEquals(
            listOf("Cloud recovery state was reset. Sign in again to continue."),
            messages
        )

        postAuthCollection.cancel()
    }

    @Test
    fun linkedCredentialRestoreCompletesWithoutExtraPostAuthSync() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        val syncRepository = FakeSyncRepository()
        val messages = mutableListOf<String>()
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = repository,
            syncRepository = syncRepository,
            messageController = TransientMessageController { message -> messages += message },
            strings = strings
        )
        val postAuthCollection = backgroundScope.async {
            viewModel.postAuthUiState.collect()
        }
        val credentials = makeCredentials(idToken = "id-token-linked-restore-success")
        repository.enqueueSendCodeResult(CloudSendCodeResult.Verified(credentials = credentials))
        repository.enqueuePreparedLinkContext(
            idToken = credentials.idToken,
            result = CompletableDeferred(
                makeLinkContext(
                    credentials = credentials,
                    email = "person@example.com",
                    workspaceId = "workspace-recovered",
                    workspaceName = "Recovered",
                    postAuthRoute = CloudWorkspacePostAuthRoute.LINKED_CREDENTIAL_RESTORE,
                    preferredWorkspaceId = "workspace-recovered"
                )
            )
        )

        viewModel.updateEmail("person@example.com")
        assertEquals(CloudSendCodeNavigationOutcome.Verified, viewModel.sendCode())
        advanceUntilIdle()
        viewModel.completePendingPostAuthIfNeeded()
        advanceUntilIdle()

        assertEquals(
            listOf(CloudWorkspaceLinkSelection.Existing(workspaceId = "workspace-recovered")),
            repository.completeCloudLinkSelections
        )
        assertEquals(0, syncRepository.syncNowCalls)
        assertEquals(CloudPostAuthMode.IDLE, viewModel.postAuthUiState.value.mode)
        assertNotNull(viewModel.postAuthUiState.value.completionToken)
        assertEquals("Signed in and synced Recovered.", messages.single())

        postAuthCollection.cancel()
    }

    @Test
    fun linkedCredentialRestoreTransientCompletionFailureKeepsRetry() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        repository.enqueueCompleteCloudLinkError(IllegalStateException("Temporary setup failure."))
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = repository,
            syncRepository = FakeSyncRepository(),
            messageController = TransientMessageController { },
            strings = strings
        )
        val postAuthCollection = backgroundScope.async {
            viewModel.postAuthUiState.collect()
        }
        val credentials = makeCredentials(idToken = "id-token-linked-restore")
        repository.enqueueSendCodeResult(CloudSendCodeResult.Verified(credentials = credentials))
        repository.enqueuePreparedLinkContext(
            idToken = credentials.idToken,
            result = CompletableDeferred(
                makeLinkContext(
                    credentials = credentials,
                    email = "person@example.com",
                    workspaceId = "workspace-recovered",
                    workspaceName = "Recovered",
                    postAuthRoute = CloudWorkspacePostAuthRoute.LINKED_CREDENTIAL_RESTORE,
                    preferredWorkspaceId = "workspace-recovered"
                )
            )
        )

        viewModel.updateEmail("person@example.com")
        assertEquals(CloudSendCodeNavigationOutcome.Verified, viewModel.sendCode())
        advanceUntilIdle()
        viewModel.completePendingPostAuthIfNeeded()
        advanceUntilIdle()

        assertEquals(CloudPostAuthMode.FAILED, viewModel.postAuthUiState.value.mode)
        assertEquals("Temporary setup failure.", viewModel.postAuthUiState.value.errorMessage)
        assertEquals(true, viewModel.postAuthUiState.value.canRetry)
        assertEquals(false, viewModel.postAuthUiState.value.canLogout)

        postAuthCollection.cancel()
    }

    @Test
    fun routeNoneRecoveryCompletionFailureBlocksRetryAndLogout() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        repository.enqueueCompleteCloudLinkError(
            CloudCredentialRecoveryRequiredException(recoveryState = makeRecoveryState())
        )
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = repository,
            syncRepository = FakeSyncRepository(),
            messageController = TransientMessageController { },
            strings = strings
        )
        val postAuthCollection = backgroundScope.async {
            viewModel.postAuthUiState.collect()
        }
        val credentials = makeCredentials(idToken = "id-token-route-none-recovery")
        repository.enqueueSendCodeResult(CloudSendCodeResult.Verified(credentials = credentials))
        repository.enqueuePreparedLinkContext(
            idToken = credentials.idToken,
            result = CompletableDeferred(
                makeLinkContext(
                    credentials = credentials,
                    email = "person@example.com",
                    workspaceId = "workspace-remote",
                    workspaceName = "Remote",
                    postAuthRoute = CloudWorkspacePostAuthRoute.NONE,
                    preferredWorkspaceId = "workspace-remote"
                )
            )
        )

        viewModel.updateEmail("person@example.com")
        assertEquals(CloudSendCodeNavigationOutcome.Verified, viewModel.sendCode())
        advanceUntilIdle()
        viewModel.completePendingPostAuthIfNeeded()
        advanceUntilIdle()

        assertEquals(CloudPostAuthMode.FAILED, viewModel.postAuthUiState.value.mode)
        assertEquals(
            "Sign in with the original cloud account and workspace to reconnect preserved local data.",
            viewModel.postAuthUiState.value.errorMessage
        )
        assertEquals(false, viewModel.postAuthUiState.value.canRetry)
        assertEquals(false, viewModel.postAuthUiState.value.canLogout)

        postAuthCollection.cancel()
    }

    @Test
    fun syncRecoveryFailureBlocksRetryAndLogout() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        val syncRepository = FakeSyncRepository()
        syncRepository.enqueueSyncError(
            CloudCredentialRecoveryRequiredException(recoveryState = makeRecoveryState())
        )
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = repository,
            syncRepository = syncRepository,
            messageController = TransientMessageController { },
            strings = strings
        )
        val postAuthCollection = backgroundScope.async {
            viewModel.postAuthUiState.collect()
        }
        val credentials = makeCredentials(idToken = "id-token-sync-recovery")
        repository.enqueueSendCodeResult(CloudSendCodeResult.Verified(credentials = credentials))
        repository.enqueuePreparedLinkContext(
            idToken = credentials.idToken,
            result = CompletableDeferred(
                makeLinkContext(
                    credentials = credentials,
                    email = "person@example.com",
                    workspaceId = "workspace-remote",
                    workspaceName = "Remote",
                    postAuthRoute = CloudWorkspacePostAuthRoute.NONE,
                    preferredWorkspaceId = "workspace-remote"
                )
            )
        )

        viewModel.updateEmail("person@example.com")
        assertEquals(CloudSendCodeNavigationOutcome.Verified, viewModel.sendCode())
        advanceUntilIdle()
        viewModel.completePendingPostAuthIfNeeded()
        advanceUntilIdle()

        assertEquals(CloudPostAuthMode.FAILED, viewModel.postAuthUiState.value.mode)
        assertEquals(
            "Sign in with the original cloud account and workspace to reconnect preserved local data.",
            viewModel.postAuthUiState.value.errorMessage
        )
        assertEquals(false, viewModel.postAuthUiState.value.canRetry)
        assertEquals(false, viewModel.postAuthUiState.value.canLogout)

        postAuthCollection.cancel()
    }

    @Test
    fun sendCodeTransportFailureShowsFriendlyMessageAndTechnicalDetails() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        repository.enqueueSendCodeError(IOException("Software caused connection abort"))
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = repository,
            syncRepository = FakeSyncRepository(),
            messageController = TransientMessageController { },
            strings = strings
        )
        val uiStateCollection = backgroundScope.async {
            viewModel.uiState.collect()
        }

        viewModel.updateEmail("person@example.com")
        val outcome = viewModel.sendCode()
        advanceUntilIdle()

        assertEquals(CloudSendCodeNavigationOutcome.NoNavigation, outcome)
        assertEquals(
            "We could not confirm that the code was sent. Check your connection and try again.",
            viewModel.uiState.value.errorMessage
        )
        assertEquals("Software caused connection abort", viewModel.uiState.value.errorTechnicalDetails)

        uiStateCollection.cancel()
    }

    @Test
    fun sendCodeServerErrorKeepsFriendlyMessageWithoutTechnicalDisclosure() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        repository.enqueueSendCodeError(
            CloudRemoteException(
                message = "Enter a valid email address. Reference: req-123",
                statusCode = 400,
                responseBody = "{\"error\":\"bad request\"}",
                errorCode = "VALIDATION_ERROR",
                requestId = "req-123",
                syncConflict = null
            )
        )
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = repository,
            syncRepository = FakeSyncRepository(),
            messageController = TransientMessageController { },
            strings = strings
        )
        val uiStateCollection = backgroundScope.async {
            viewModel.uiState.collect()
        }

        viewModel.updateEmail("person@example.com")
        viewModel.sendCode()
        advanceUntilIdle()

        assertEquals("Enter a valid email address. Reference: req-123", viewModel.uiState.value.errorMessage)
        assertNull(viewModel.uiState.value.errorTechnicalDetails)

        uiStateCollection.cancel()
    }

    @Test
    fun verifyCodeTransportFailureShowsFriendlyMessageAndTechnicalDetails() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        repository.enqueueSendCodeResult(
            CloudSendCodeResult.OtpRequired(
                challenge = CloudOtpChallenge(
                    email = "person@example.com",
                    csrfToken = "csrf-token",
                    otpSessionToken = "otp-session-token"
                )
            )
        )
        repository.enqueueVerifyCodeError(IOException("Connection reset by peer"))
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = repository,
            syncRepository = FakeSyncRepository(),
            messageController = TransientMessageController { },
            strings = strings
        )
        val uiStateCollection = backgroundScope.async {
            viewModel.uiState.collect()
        }

        viewModel.updateEmail("person@example.com")
        assertEquals(CloudSendCodeNavigationOutcome.OtpRequired, viewModel.sendCode())
        viewModel.updateCode("123456")
        val didVerify = viewModel.verifyCode()
        advanceUntilIdle()

        assertEquals(false, didVerify)
        assertEquals(
            "We could not verify the code right now. Check your connection and try again.",
            viewModel.uiState.value.errorMessage
        )
        assertEquals("Connection reset by peer", viewModel.uiState.value.errorTechnicalDetails)

        uiStateCollection.cancel()
    }

    private fun makeCredentials(idToken: String): StoredCloudCredentials {
        return StoredCloudCredentials(
            refreshToken = "refresh-$idToken",
            idToken = idToken,
            idTokenExpiresAtMillis = Long.MAX_VALUE
        )
    }

    private fun makeLinkContext(
        credentials: StoredCloudCredentials,
        email: String,
        workspaceId: String,
        workspaceName: String,
        postAuthRoute: CloudWorkspacePostAuthRoute,
        preferredWorkspaceId: String
    ): CloudWorkspaceLinkContext {
        return CloudWorkspaceLinkContext(
            userId = "user-$workspaceId",
            email = email,
            credentials = credentials,
            workspaces = listOf(
                CloudWorkspaceSummary(
                    workspaceId = workspaceId,
                    name = workspaceName,
                    createdAtMillis = 100L,
                    isSelected = true
                )
            ),
            postAuthRoute = postAuthRoute,
            guestUpgradeMode = null,
            preferredWorkspaceId = preferredWorkspaceId
        )
    }

    private fun makeRecoveryState(): CloudCredentialRecoveryState {
        return CloudCredentialRecoveryState(
            reason = CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING,
            previousCloudState = CloudAccountState.LINKED,
            installationId = "installation-1",
            linkedUserId = "user-1",
            linkedWorkspaceId = "workspace-local",
            activeWorkspaceId = "workspace-local",
            linkedEmail = "person@example.com",
            configurationMode = makeOfficialCloudServiceConfiguration().mode,
            apiBaseUrl = makeOfficialCloudServiceConfiguration().apiBaseUrl,
            detectedAtMillis = 100L
        )
    }
}

private class FakeCloudAccountRepository : CloudAccountRepository {
    private val cloudSettings = MutableStateFlow(
        CloudSettings(
            installationId = "installation-1",
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = "workspace-local",
            updatedAtMillis = 0L
        )
    )
    private val accountPreferences = MutableStateFlow(defaultAccountPreferences())
    private val accountDeletionState = MutableStateFlow<AccountDeletionState>(AccountDeletionState.Hidden)
    private val serverConfiguration = MutableStateFlow(makeOfficialCloudServiceConfiguration())
    private val cloudCredentialRecoveryState = MutableStateFlow<CloudCredentialRecoveryState?>(null)
    private val sendCodeResults = ArrayDeque<CloudSendCodeResult>()
    private val sendCodeErrors = ArrayDeque<Exception>()
    private val verifyCodeErrors = ArrayDeque<Exception>()
    private val completeCloudLinkErrors = ArrayDeque<Exception>()
    private val completeCloudLinkResults = ArrayDeque<CompletableDeferred<CloudWorkspaceSummary>>()
    private val preparedLinkContexts = mutableMapOf<String, CompletableDeferred<CloudWorkspaceLinkContext>>()
    val completeCloudLinkSelections = mutableListOf<CloudWorkspaceLinkSelection>()
    var resetInvalidCloudCredentialRecoveryStateCalls: Int = 0
        private set
    var logoutCalls: Int = 0
        private set

    fun enqueueSendCodeResult(result: CloudSendCodeResult) {
        sendCodeResults.addLast(result)
    }

    fun enqueueSendCodeError(error: Exception) {
        sendCodeErrors.addLast(error)
    }

    fun enqueueVerifyCodeError(error: Exception) {
        verifyCodeErrors.addLast(error)
    }

    fun enqueueCompleteCloudLinkError(error: Exception) {
        completeCloudLinkErrors.addLast(error)
    }

    fun enqueueCompleteCloudLinkResult(result: CompletableDeferred<CloudWorkspaceSummary>) {
        completeCloudLinkResults.addLast(result)
    }

    fun enqueuePreparedLinkContext(
        idToken: String,
        result: CompletableDeferred<CloudWorkspaceLinkContext>
    ) {
        preparedLinkContexts[idToken] = result
    }

    override fun observeCloudSettings(): Flow<CloudSettings> {
        return cloudSettings
    }

    override fun observeAccountPreferences(): Flow<AccountPreferences> {
        return accountPreferences
    }

    override fun observeAccountDeletionState(): Flow<AccountDeletionState> {
        return accountDeletionState
    }

    override fun observeServerConfiguration(): Flow<CloudServiceConfiguration> {
        return serverConfiguration
    }

    override fun observeCloudCredentialRecoveryState(): Flow<CloudCredentialRecoveryState?> {
        return cloudCredentialRecoveryState
    }

    override suspend fun eraseLocalDataForCredentialRecovery() {
        throw UnsupportedOperationException()
    }

    override suspend fun beginAccountDeletion() {
        throw UnsupportedOperationException()
    }

    override suspend fun resumePendingAccountDeletionIfNeeded() {
        throw UnsupportedOperationException()
    }

    override suspend fun retryPendingAccountDeletion() {
        throw UnsupportedOperationException()
    }

    override suspend fun refreshAccountContext() {
    }

    override suspend fun updateAccountPreferences(preferences: AccountPreferences): AccountPreferences {
        accountPreferences.value = preferences
        return preferences
    }

    override suspend fun sendCode(email: String): CloudSendCodeResult {
        if (sendCodeErrors.isNotEmpty()) {
            throw sendCodeErrors.removeFirst()
        }
        return sendCodeResults.removeFirst()
    }

    override suspend fun prepareVerifiedSignIn(credentials: StoredCloudCredentials): CloudWorkspaceLinkContext {
        return requireNotNull(preparedLinkContexts[credentials.idToken]) {
            "Missing prepared link context for ${credentials.idToken}"
        }.await()
    }

    override suspend fun verifyCode(challenge: CloudOtpChallenge, code: String): CloudWorkspaceLinkContext {
        if (verifyCodeErrors.isNotEmpty()) {
            throw verifyCodeErrors.removeFirst()
        }
        throw UnsupportedOperationException()
    }

    override suspend fun completeCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        completeCloudLinkSelections += selection
        if (completeCloudLinkErrors.isNotEmpty()) {
            throw completeCloudLinkErrors.removeFirst()
        }
        if (completeCloudLinkResults.isNotEmpty()) {
            return completeCloudLinkResults.removeFirst().await()
        }
        return when (selection) {
            is CloudWorkspaceLinkSelection.Existing -> requireNotNull(
                linkContext.workspaces.firstOrNull { workspace -> workspace.workspaceId == selection.workspaceId }
            ) {
                "Selected workspace is missing from test link context."
            }

            CloudWorkspaceLinkSelection.CreateNew -> CloudWorkspaceSummary(
                workspaceId = "workspace-new",
                name = "Personal",
                createdAtMillis = 200L,
                isSelected = true
            )
        }
    }

    override suspend fun completeGuestUpgrade(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun completeLinkedWorkspaceTransition(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun resetInvalidCloudCredentialRecoveryState() {
        resetInvalidCloudCredentialRecoveryStateCalls += 1
    }

    override suspend fun logout() {
        logoutCalls += 1
    }

    override suspend fun renameCurrentWorkspace(name: String): CloudWorkspaceSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun loadCurrentWorkspaceDeletePreview(): CloudWorkspaceDeletePreview {
        throw UnsupportedOperationException()
    }

    override suspend fun deleteCurrentWorkspace(confirmationText: String): CloudWorkspaceDeleteResult {
        throw UnsupportedOperationException()
    }

    override suspend fun loadCurrentWorkspaceResetProgressPreview(): CloudWorkspaceResetProgressPreview {
        throw UnsupportedOperationException()
    }

    override suspend fun resetCurrentWorkspaceProgress(confirmationText: String): CloudWorkspaceResetProgressResult {
        throw UnsupportedOperationException()
    }

    override suspend fun loadProgressSummary(timeZone: String): CloudProgressSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun loadProgressSeries(timeZone: String, from: String, to: String): CloudProgressSeries {
        throw UnsupportedOperationException()
    }

    override suspend fun loadProgressReviewSchedule(timeZone: String): CloudProgressReviewSchedule {
        throw UnsupportedOperationException()
    }

    override suspend fun deleteAccount(confirmationText: String) {
        throw UnsupportedOperationException()
    }

    override suspend fun listLinkedWorkspaces(): List<CloudWorkspaceSummary> {
        throw UnsupportedOperationException()
    }

    override suspend fun switchLinkedWorkspace(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun listAgentConnections(): AgentApiKeyConnectionsResult {
        throw UnsupportedOperationException()
    }

    override suspend fun revokeAgentConnection(connectionId: String): AgentApiKeyConnectionsResult {
        throw UnsupportedOperationException()
    }

    override suspend fun currentServerConfiguration(): CloudServiceConfiguration {
        return makeOfficialCloudServiceConfiguration()
    }

    override suspend fun validateCustomServer(customOrigin: String): CloudServiceConfiguration {
        throw UnsupportedOperationException()
    }

    override suspend fun applyCustomServer(configuration: CloudServiceConfiguration) {
        throw UnsupportedOperationException()
    }

    override suspend fun resetToOfficialServer() {
        throw UnsupportedOperationException()
    }
}

private class TestSettingsStringResolver : SettingsStringResolver {
    override fun get(stringResId: Int, vararg formatArgs: Any): String {
        val pattern = when (stringResId) {
            R.string.settings_sign_in_request_code_first -> "Request a sign-in code first."
            R.string.settings_sign_in_cancelled_message -> {
                "Signed-in setup was cancelled. This device is disconnected."
            }

            R.string.settings_sign_in_send_code_transport_failed -> {
                "We could not confirm that the code was sent. Check your connection and try again."
            }

            R.string.settings_sign_in_send_code_failed -> "Could not send the sign-in code."
            R.string.settings_sign_in_verify_transport_failed -> {
                "We could not verify the code right now. Check your connection and try again."
            }

            R.string.settings_sign_in_verify_failed -> "Could not verify the code."
            R.string.settings_current_workspace_new_title -> "New workspace"
            R.string.settings_logout -> "Log out"
            R.string.settings_current_workspace_create_new_title -> "Create new workspace"
            R.string.settings_current_workspace_create_new_summary -> {
                "Start a new linked workspace in the cloud"
            }

            R.string.settings_unavailable -> "Unavailable"
            R.string.settings_never -> "Never"
            R.string.settings_post_auth_upgrading_title -> "Upgrading guest account"
            R.string.settings_post_auth_linking_title -> "Linking workspace"
            R.string.settings_post_auth_recovering_local_data_title -> "Recovering local data"
            R.string.settings_post_auth_upgrading_body -> {
                "Preparing your Guest AI session for a linked Android cloud account."
            }

            R.string.settings_post_auth_linking_body -> {
                "Preparing your cloud workspace on this Android device."
            }

            R.string.settings_post_auth_recovering_local_data_body -> {
                "Keep this screen open while Android reconnects preserved local data to your recovered workspace."
            }

            R.string.settings_post_auth_guest_upgrade_failed -> "Guest account upgrade failed."
            R.string.settings_post_auth_setup_failed -> "Cloud workspace setup failed."
            R.string.settings_post_auth_syncing_title -> "Syncing workspace"
            R.string.settings_post_auth_syncing_body -> {
                "Keep this screen open while Android finishes the initial cloud sync."
            }

            R.string.settings_post_auth_signed_in_and_synced -> "Signed in and synced %1\$s."
            R.string.settings_post_auth_guest_local_recovery_failed -> {
                "Local data recovery failed. Try again; local data stays on this device."
            }

            R.string.settings_post_auth_sync_failed -> "Initial sync failed."
            R.string.settings_post_auth_linked_recovery_blocked -> {
                "Sign in with the original cloud account and workspace to reconnect preserved local data."
            }

            R.string.settings_post_auth_guest_local_recovery_required -> {
                "Guest credentials are missing on this device. Local data is preserved for recovery in a linked workspace."
            }

            R.string.settings_post_auth_pending_guest_upgrade_recovery_required -> {
                "Account upgrade recovery is pending. Reopen the app to finish recovery before signing in again."
            }

            R.string.settings_post_auth_invalid_recovery_state -> {
                "Cloud recovery data on this device is invalid. Reset cloud identity or sign in again after clearing recovery."
            }

            R.string.settings_post_auth_reset_cloud_identity_button -> "Reset cloud identity"

            R.string.settings_post_auth_invalid_recovery_state_cleared_message -> {
                "Cloud recovery state was reset. Sign in again to continue."
            }

            else -> error("Unexpected string resource id in CloudSignInViewModelTest: $stringResId")
        }
        return if (formatArgs.isEmpty()) {
            pattern
        } else {
            String.format(Locale.ENGLISH, pattern, *formatArgs)
        }
    }

    override fun getQuantity(pluralsResId: Int, quantity: Int, vararg formatArgs: Any): String {
        error("Unexpected plurals resource id in CloudSignInViewModelTest: $pluralsResId")
    }

    override fun locale(): Locale {
        return Locale.ENGLISH
    }
}

private class FakeSyncRepository : SyncRepository {
    private val syncErrors = ArrayDeque<Exception>()
    private val syncStatus = MutableStateFlow(
        SyncStatusSnapshot(
            status = SyncStatus.Idle,
            lastSuccessfulSyncAtMillis = null,
            lastErrorMessage = ""
        )
    )
    var syncNowCalls: Int = 0
        private set

    override fun observeSyncStatus(): Flow<SyncStatusSnapshot> {
        return syncStatus
    }

    override suspend fun scheduleSync() {
    }

    override suspend fun syncNow() {
        syncNowCalls += 1
        if (syncErrors.isNotEmpty()) {
            throw syncErrors.removeFirst()
        }
    }

    fun enqueueSyncError(error: Exception) {
        syncErrors.addLast(error)
    }
}
