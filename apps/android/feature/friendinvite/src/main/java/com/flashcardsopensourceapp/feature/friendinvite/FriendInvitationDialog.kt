package com.flashcardsopensourceapp.feature.friendinvite

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

@Composable
fun FriendInvitationDialog(
    uiState: FriendInvitationUiState,
    displayNameFieldTag: String,
    onCreateFriendInvitation: (String) -> Unit,
    onClearFriendInvitationFailure: () -> Unit,
    onDismiss: () -> Unit
) {
    var displayName by rememberSaveable { mutableStateOf("") }
    var didAttemptCreate by rememberSaveable { mutableStateOf(false) }
    val validation = validateFriendInvitationDisplayName(displayName = displayName)
    val validationError = (validation as? FriendInvitationDisplayNameValidation.Invalid)?.error
    val failedValidationError = (uiState as? FriendInvitationUiState.ValidationFailed)?.error
    val displayedError = validationError?.takeIf {
        didAttemptCreate || displayName.isNotEmpty()
    } ?: failedValidationError
    val createError = (uiState as? FriendInvitationUiState.CreateFailed)?.error
    val isCreating = uiState is FriendInvitationUiState.Creating

    LaunchedEffect(uiState) {
        if (uiState is FriendInvitationUiState.Created) {
            displayName = ""
            didAttemptCreate = false
            onDismiss()
        }
    }

    AlertDialog(
        onDismissRequest = {
            if (isCreating.not()) {
                displayName = ""
                didAttemptCreate = false
                onClearFriendInvitationFailure()
                onDismiss()
            }
        },
        confirmButton = {
            TextButton(
                enabled = isCreating.not(),
                onClick = {
                    didAttemptCreate = true
                    if (validation is FriendInvitationDisplayNameValidation.Valid) {
                        onCreateFriendInvitation(validation.trimmedDisplayName)
                    } else {
                        onCreateFriendInvitation(displayName)
                    }
                }
            ) {
                if (isCreating) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp))
                } else {
                    Text(stringResource(id = R.string.friend_invite_create_button))
                }
            }
        },
        dismissButton = {
            TextButton(
                enabled = isCreating.not(),
                onClick = {
                    displayName = ""
                    didAttemptCreate = false
                    onClearFriendInvitationFailure()
                    onDismiss()
                }
            ) {
                Text(stringResource(id = R.string.friend_invite_cancel_button))
            }
        },
        title = {
            Text(stringResource(id = R.string.friend_invite_dialog_title))
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = displayName,
                    onValueChange = { updatedDisplayName ->
                        displayName = updatedDisplayName
                        onClearFriendInvitationFailure()
                    },
                    singleLine = true,
                    enabled = isCreating.not(),
                    isError = displayedError != null,
                    label = {
                        Text(stringResource(id = R.string.friend_invite_display_name_label))
                    },
                    supportingText = {
                        val error = displayedError
                        if (error != null) {
                            Text(friendInvitationDisplayNameErrorLabel(error = error))
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(displayNameFieldTag)
                )
                Text(
                    text = stringResource(id = R.string.friend_invite_expiry_note),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
                if (createError != null) {
                    Text(
                        text = friendInvitationCreateErrorLabel(error = createError),
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
        }
    )
}

@Composable
private fun friendInvitationCreateErrorLabel(
    error: FriendInvitationCreateError
): String {
    val stringResId = when (error) {
        FriendInvitationCreateError.LIMIT_REACHED -> R.string.friend_invite_create_limit_reached
        FriendInvitationCreateError.SIGN_IN_REQUIRED -> R.string.friend_invite_create_sign_in_required
        FriendInvitationCreateError.INVALID_DISPLAY_NAME -> R.string.friend_invite_create_invalid_name
        FriendInvitationCreateError.GENERIC -> R.string.friend_invite_create_failed
    }
    return stringResource(id = stringResId)
}

@Composable
private fun friendInvitationDisplayNameErrorLabel(
    error: FriendInvitationDisplayNameError
): String {
    val stringResId = when (error) {
        FriendInvitationDisplayNameError.EMPTY -> R.string.friend_invite_display_name_empty
        FriendInvitationDisplayNameError.TOO_LONG -> R.string.friend_invite_display_name_too_long
        FriendInvitationDisplayNameError.CONTROL_CHARACTER -> {
            R.string.friend_invite_display_name_control_character
        }
    }
    return stringResource(id = stringResId)
}
