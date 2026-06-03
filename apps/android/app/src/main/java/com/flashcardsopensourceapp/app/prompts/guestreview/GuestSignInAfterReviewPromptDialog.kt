package com.flashcardsopensourceapp.app.prompts.guestreview

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.flashcardsopensourceapp.app.R

const val guestSignInAfterReviewPromptTag: String = "guest_sign_in_after_review_prompt"
const val guestSignInAfterReviewPromptSignInButtonTag: String =
    "guest_sign_in_after_review_prompt_sign_in_button"
const val guestSignInAfterReviewPromptLaterButtonTag: String =
    "guest_sign_in_after_review_prompt_later_button"

@Composable
internal fun GuestSignInAfterReviewPromptDialog(
    onSignIn: () -> Unit,
    onLater: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onLater,
        confirmButton = {
            TextButton(
                onClick = onSignIn,
                modifier = Modifier.testTag(tag = guestSignInAfterReviewPromptSignInButtonTag)
            ) {
                Text(stringResource(id = R.string.guest_sign_in_after_review_prompt_sign_in))
            }
        },
        dismissButton = {
            TextButton(
                onClick = onLater,
                modifier = Modifier.testTag(tag = guestSignInAfterReviewPromptLaterButtonTag)
            ) {
                Text(stringResource(id = R.string.guest_sign_in_after_review_prompt_later))
            }
        },
        title = {
            Text(stringResource(id = R.string.guest_sign_in_after_review_prompt_title))
        },
        text = {
            Text(stringResource(id = R.string.guest_sign_in_after_review_prompt_body))
        },
        modifier = Modifier.testTag(tag = guestSignInAfterReviewPromptTag)
    )
}
