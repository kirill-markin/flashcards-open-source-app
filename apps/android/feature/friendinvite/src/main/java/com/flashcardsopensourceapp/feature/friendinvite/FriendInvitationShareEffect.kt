package com.flashcardsopensourceapp.feature.friendinvite

import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources

@Composable
fun FriendInvitationShareEffect(
    uiState: FriendInvitationUiState,
    onFriendInvitationShared: (Long) -> Unit
) {
    val context = LocalContext.current
    val resources = LocalResources.current

    LaunchedEffect(uiState) {
        val createdState = uiState as? FriendInvitationUiState.Created
            ?: return@LaunchedEffect
        val shareIntent = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(
                Intent.EXTRA_TEXT,
                resources.getString(R.string.friend_invite_share_text, createdState.inviteUrl)
            )
        context.startActivity(
            Intent.createChooser(
                shareIntent,
                resources.getString(R.string.friend_invite_share_title)
            )
        )
        onFriendInvitationShared(createdState.shareId)
    }
}
