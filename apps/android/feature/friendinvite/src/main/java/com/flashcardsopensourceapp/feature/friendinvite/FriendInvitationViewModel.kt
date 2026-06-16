package com.flashcardsopensourceapp.feature.friendinvite

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateRequest
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateResponse
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private const val friendInvitationDisplayNameMaxCodePointCount: Int = 30
private const val accountSignInRequiredErrorCode: String = "ACCOUNT_SIGN_IN_REQUIRED"
private const val authUnauthorizedErrorCode: String = "AUTH_UNAUTHORIZED"
private const val friendInvitationDisplayNameInvalidErrorCode: String = "FRIEND_INVITATION_DISPLAY_NAME_INVALID"
private const val friendInvitationHumanAuthRequiredErrorCode: String = "FRIEND_INVITATION_HUMAN_AUTH_REQUIRED"
private const val friendInvitationLimitReachedErrorCode: String = "FRIEND_INVITATION_LIMIT_REACHED"
private const val friendInvitationViewModelLogTag: String = "FriendInvitationViewModel"

class FriendInvitationViewModel(
    private val createInvitation: suspend (CloudFriendInvitationCreateRequest) -> CloudFriendInvitationCreateResponse
) : ViewModel() {
    private val uiStateMutable = MutableStateFlow<FriendInvitationUiState>(
        FriendInvitationUiState.Idle
    )
    val uiState: StateFlow<FriendInvitationUiState> = uiStateMutable.asStateFlow()
    private var nextShareId: Long = 1L

    fun createFriendInvitation(inviteeDisplayName: String) {
        if (uiStateMutable.value is FriendInvitationUiState.Creating) {
            return
        }

        val validation = validateFriendInvitationDisplayName(displayName = inviteeDisplayName)
        if (validation is FriendInvitationDisplayNameValidation.Invalid) {
            uiStateMutable.value = FriendInvitationUiState.ValidationFailed(
                error = validation.error
            )
            return
        }

        val validValidation = validation as FriendInvitationDisplayNameValidation.Valid
        uiStateMutable.value = FriendInvitationUiState.Creating
        viewModelScope.launch {
            try {
                val invitation = createInvitation(
                    CloudFriendInvitationCreateRequest(
                        inviteeDisplayName = validValidation.trimmedDisplayName
                    )
                )
                val shareId = nextShareId
                nextShareId += 1
                uiStateMutable.value = FriendInvitationUiState.Created(
                    shareId = shareId,
                    inviteUrl = invitation.inviteUrl
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                logFriendInvitationViewModelWarning(
                    event = "friend_invitation_create_failed",
                    error = error
                )
                uiStateMutable.value = FriendInvitationUiState.CreateFailed(
                    error = resolveFriendInvitationCreateError(error = error)
                )
            }
        }
    }

    fun clearFriendInvitationFailure() {
        val currentState = uiStateMutable.value
        if (
            currentState is FriendInvitationUiState.ValidationFailed ||
            currentState is FriendInvitationUiState.CreateFailed
        ) {
            uiStateMutable.value = FriendInvitationUiState.Idle
        }
    }

    fun markFriendInvitationShared(shareId: Long) {
        val currentState = uiStateMutable.value
        if (currentState is FriendInvitationUiState.Created && currentState.shareId == shareId) {
            uiStateMutable.value = FriendInvitationUiState.Idle
        }
    }
}

internal fun validateFriendInvitationDisplayName(
    displayName: String
): FriendInvitationDisplayNameValidation {
    val trimmedDisplayName = displayName.trim()
    if (trimmedDisplayName.isEmpty()) {
        return FriendInvitationDisplayNameValidation.Invalid(
            error = FriendInvitationDisplayNameError.EMPTY
        )
    }
    if (containsFriendInvitationControlCharacter(displayName = displayName)) {
        return FriendInvitationDisplayNameValidation.Invalid(
            error = FriendInvitationDisplayNameError.CONTROL_CHARACTER
        )
    }
    if (trimmedDisplayName.codePointCount(0, trimmedDisplayName.length) > friendInvitationDisplayNameMaxCodePointCount) {
        return FriendInvitationDisplayNameValidation.Invalid(
            error = FriendInvitationDisplayNameError.TOO_LONG
        )
    }

    return FriendInvitationDisplayNameValidation.Valid(
        trimmedDisplayName = trimmedDisplayName
    )
}

private fun containsFriendInvitationControlCharacter(
    displayName: String
): Boolean {
    return displayName.any { character ->
        character.code <= 0x1F || character.code == 0x7F
    }
}

private fun resolveFriendInvitationCreateError(
    error: Exception
): FriendInvitationCreateError {
    val remoteError = error as? CloudRemoteException
    return when (remoteError?.errorCode) {
        friendInvitationLimitReachedErrorCode -> FriendInvitationCreateError.LIMIT_REACHED
        accountSignInRequiredErrorCode,
        authUnauthorizedErrorCode,
        friendInvitationHumanAuthRequiredErrorCode -> FriendInvitationCreateError.SIGN_IN_REQUIRED
        friendInvitationDisplayNameInvalidErrorCode -> FriendInvitationCreateError.INVALID_DISPLAY_NAME
        else -> FriendInvitationCreateError.GENERIC
    }
}

private fun logFriendInvitationViewModelWarning(
    event: String,
    error: Throwable
) {
    val message = "event=$event"
    val didLog = runCatching {
        Log.w(friendInvitationViewModelLogTag, message, error)
    }.isSuccess
    if (didLog.not()) {
        println("$friendInvitationViewModelLogTag W $message")
        println(error.stackTraceToString())
    }
}

fun createFriendInvitationViewModelFactory(
    cloudAccountRepository: CloudAccountRepository
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            FriendInvitationViewModel(
                createInvitation = cloudAccountRepository::createFriendInvitation
            )
        }
    }
}
