package com.flashcardsopensourceapp.feature.friendinvite

enum class FriendInvitationDisplayNameError {
    EMPTY,
    TOO_LONG,
    CONTROL_CHARACTER
}

enum class FriendInvitationCreateError {
    LIMIT_REACHED,
    SIGN_IN_REQUIRED,
    INVALID_DISPLAY_NAME,
    GENERIC
}

sealed interface FriendInvitationDisplayNameValidation {
    data class Valid(
        val trimmedDisplayName: String
    ) : FriendInvitationDisplayNameValidation

    data class Invalid(
        val error: FriendInvitationDisplayNameError
    ) : FriendInvitationDisplayNameValidation
}

sealed interface FriendInvitationUiState {
    data object Idle : FriendInvitationUiState

    data object Creating : FriendInvitationUiState

    data class Created(
        val shareId: Long,
        val inviteUrl: String
    ) : FriendInvitationUiState

    data class ValidationFailed(
        val error: FriendInvitationDisplayNameError
    ) : FriendInvitationUiState

    data class CreateFailed(
        val error: FriendInvitationCreateError
    ) : FriendInvitationUiState
}
