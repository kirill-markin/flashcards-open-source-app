package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.CloudPostAuthMode
import com.flashcardsopensourceapp.feature.settings.cloud.signIn.CloudSendCodeNavigationOutcome
import com.flashcardsopensourceapp.feature.settings.cloud.signIn.CloudSignInViewModel
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
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
    fun postAuthWorkspaceSetupCancellationRethrowsWithRetryState() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        repository.enqueueCompleteCloudLinkError(CancellationException("Cloud request was cancelled."))
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = repository,
            syncRepository = FakeSyncRepository(),
            messageController = TransientMessageController { },
            strings = strings
        )
        val postAuthCollection = backgroundScope.async {
            viewModel.postAuthUiState.collect()
        }
        val credentials = makeCredentials(idToken = "id-token-setup-cancelled")
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

        val error = try {
            viewModel.completePendingPostAuthIfNeeded()
            null
        } catch (caught: CancellationException) {
            caught
        }
        advanceUntilIdle()

        assertNotNull(error)
        assertEquals(CloudPostAuthMode.FAILED, viewModel.postAuthUiState.value.mode)
        assertEquals("Cloud workspace setup failed.", viewModel.postAuthUiState.value.errorMessage)
        assertEquals("", viewModel.postAuthUiState.value.processingTitle)
        assertEquals(true, viewModel.postAuthUiState.value.canRetry)

        postAuthCollection.cancel()
    }

    @Test
    fun postAuthInitialSyncCancellationRethrowsWithRetryState() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        val syncRepository = FakeSyncRepository()
        syncRepository.enqueueSyncError(CancellationException("Cloud request was cancelled."))
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = repository,
            syncRepository = syncRepository,
            messageController = TransientMessageController { },
            strings = strings
        )
        val postAuthCollection = backgroundScope.async {
            viewModel.postAuthUiState.collect()
        }
        val credentials = makeCredentials(idToken = "id-token-sync-cancelled")
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

        val error = try {
            viewModel.completePendingPostAuthIfNeeded()
            null
        } catch (caught: CancellationException) {
            caught
        }
        advanceUntilIdle()

        assertNotNull(error)
        assertEquals(1, syncRepository.syncNowCalls)
        assertEquals(CloudPostAuthMode.FAILED, viewModel.postAuthUiState.value.mode)
        assertEquals("", viewModel.postAuthUiState.value.processingTitle)
        assertEquals("Initial sync failed.", viewModel.postAuthUiState.value.errorMessage)
        assertEquals(true, viewModel.postAuthUiState.value.canRetry)

        postAuthCollection.cancel()
    }

    @Test
    fun sendCodeCancellationRethrowsWithoutLoadingState() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        repository.enqueueSendCodeError(CancellationException("Cloud request was cancelled."))
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
        val error = try {
            viewModel.sendCode()
            null
        } catch (caught: CancellationException) {
            caught
        }
        advanceUntilIdle()

        assertNotNull(error)
        assertEquals(false, viewModel.uiState.value.isSendingCode)
        assertEquals("", viewModel.uiState.value.errorMessage)

        uiStateCollection.cancel()
    }

    @Test
    fun verifyCodeCancellationRethrowsWithoutLoadingState() = runTest(dispatcher) {
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
        repository.enqueueVerifyCodeError(CancellationException("Cloud request was cancelled."))
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
        viewModel.updateCode("12345678")
        val error = try {
            viewModel.verifyCode()
            null
        } catch (caught: CancellationException) {
            caught
        }
        advanceUntilIdle()

        assertNotNull(error)
        assertEquals(false, viewModel.uiState.value.isVerifyingCode)
        assertEquals("", viewModel.uiState.value.errorMessage)

        uiStateCollection.cancel()
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
}
