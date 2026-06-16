package com.flashcardsopensourceapp.feature.friendinvite

import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateRequest
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class FriendInvitationViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Test
    fun displayNameValidationTrimsEmojiAndRejectsControlCharacters() {
        val valid = validateFriendInvitationDisplayName(displayName = "  Priya \uD83C\uDFAF  ")
            as FriendInvitationDisplayNameValidation.Valid
        val invalid = validateFriendInvitationDisplayName(displayName = "Line\nBreak")
            as FriendInvitationDisplayNameValidation.Invalid

        assertEquals("Priya \uD83C\uDFAF", valid.trimmedDisplayName)
        assertEquals(FriendInvitationDisplayNameError.CONTROL_CHARACTER, invalid.error)
    }

    @Test
    fun createFriendInvitationTrimsNameAndEmitsShareState() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val createInvitation = FakeFriendInvitationCreator()
            val viewModel = createFriendInvitationViewModelForTest(createInvitation = createInvitation)

            viewModel.createFriendInvitation(inviteeDisplayName = "  Priya \uD83C\uDFAF  ")
            advanceUntilIdle()

            assertEquals(
                "Priya \uD83C\uDFAF",
                createInvitation.requests.single().inviteeDisplayName
            )
            val createdState = viewModel.uiState.value as FriendInvitationUiState.Created
            assertEquals("https://app.flashcards-open-source-app.com/invite/raw-token", createdState.inviteUrl)

            viewModel.markFriendInvitationShared(shareId = createdState.shareId)
            assertEquals(FriendInvitationUiState.Idle, viewModel.uiState.value)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun createFriendInvitationRejectsInvalidNameBeforeRepositoryCall() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val createInvitation = FakeFriendInvitationCreator()
            val viewModel = createFriendInvitationViewModelForTest(createInvitation = createInvitation)

            viewModel.createFriendInvitation(inviteeDisplayName = "Line\nBreak")
            advanceUntilIdle()

            assertTrue(createInvitation.requests.isEmpty())
            val failedState = viewModel.uiState.value as FriendInvitationUiState.ValidationFailed
            assertEquals(FriendInvitationDisplayNameError.CONTROL_CHARACTER, failedState.error)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun createFriendInvitationIgnoresDuplicateRequestWhileCreating() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val createInvitation = FakeFriendInvitationCreator()
            val viewModel = createFriendInvitationViewModelForTest(createInvitation = createInvitation)

            viewModel.createFriendInvitation(inviteeDisplayName = "Priya")
            viewModel.createFriendInvitation(inviteeDisplayName = "Priya")
            advanceUntilIdle()

            assertEquals(1, createInvitation.requests.size)
            assertTrue(viewModel.uiState.value is FriendInvitationUiState.Created)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun createFriendInvitationMapsRemoteErrorCodesToActionableFailures() = runTest(dispatcher) {
        val cases = listOf(
            "FRIEND_INVITATION_LIMIT_REACHED" to FriendInvitationCreateError.LIMIT_REACHED,
            "FRIEND_INVITATION_HUMAN_AUTH_REQUIRED" to FriendInvitationCreateError.SIGN_IN_REQUIRED,
            "ACCOUNT_SIGN_IN_REQUIRED" to FriendInvitationCreateError.SIGN_IN_REQUIRED,
            "AUTH_UNAUTHORIZED" to FriendInvitationCreateError.SIGN_IN_REQUIRED,
            "FRIEND_INVITATION_DISPLAY_NAME_INVALID" to FriendInvitationCreateError.INVALID_DISPLAY_NAME,
            "FRIEND_INVITATION_FIELD_UNKNOWN" to FriendInvitationCreateError.GENERIC
        )

        Dispatchers.setMain(dispatcher)
        try {
            for ((errorCode, expectedError) in cases) {
                val createInvitation = FakeFriendInvitationCreator()
                createInvitation.enqueueError(
                    error = createFriendInvitationRemoteException(
                        errorCode = errorCode,
                        statusCode = 400
                    )
                )
                val viewModel = createFriendInvitationViewModelForTest(createInvitation = createInvitation)

                viewModel.createFriendInvitation(inviteeDisplayName = "Priya")
                advanceUntilIdle()

                assertEquals(1, createInvitation.requests.size)
                assertEquals(
                    FriendInvitationUiState.CreateFailed(error = expectedError),
                    viewModel.uiState.value
                )
            }
        } finally {
            Dispatchers.resetMain()
        }
    }
}

private fun createFriendInvitationViewModelForTest(
    createInvitation: FakeFriendInvitationCreator
): FriendInvitationViewModel {
    return FriendInvitationViewModel(
        createInvitation = createInvitation::create
    )
}

private fun createFriendInvitationRemoteException(
    errorCode: String,
    statusCode: Int
): CloudRemoteException {
    return CloudRemoteException(
        message = "Friend invitation create failed.",
        statusCode = statusCode,
        responseBody = "{\"code\":\"$errorCode\"}",
        errorCode = errorCode,
        requestId = "req-1",
        syncConflict = null
    )
}

private class FakeFriendInvitationCreator {
    val requests: MutableList<CloudFriendInvitationCreateRequest> = mutableListOf()
    private val errors: ArrayDeque<Exception> = ArrayDeque()

    fun enqueueError(error: Exception) {
        errors.add(error)
    }

    suspend fun create(request: CloudFriendInvitationCreateRequest): CloudFriendInvitationCreateResponse {
        requests += request
        if (errors.isNotEmpty()) {
            throw errors.removeFirst()
        }
        return CloudFriendInvitationCreateResponse(
            inviteUrl = "https://app.flashcards-open-source-app.com/invite/raw-token",
            expiresAt = "2026-06-17T10:00:00.000Z"
        )
    }
}
