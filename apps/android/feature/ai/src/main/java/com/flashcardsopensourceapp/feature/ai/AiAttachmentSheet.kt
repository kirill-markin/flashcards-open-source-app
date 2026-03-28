package com.flashcardsopensourceapp.feature.ai

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

internal enum class AttachmentAction {
    TAKE_PHOTO,
    CHOOSE_PHOTO,
    CHOOSE_FILE
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AttachmentSheet(
    onDismiss: () -> Unit,
    onSelectAction: (AttachmentAction) -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss
    ) {
        LazyColumn(
            contentPadding = PaddingValues(bottom = 24.dp)
        ) {
            item {
                ListItem(
                    headlineContent = {
                        Text("Take photo")
                    },
                    leadingContent = {
                        Icon(Icons.Outlined.CameraAlt, contentDescription = null)
                    },
                    modifier = Modifier.padding(horizontal = 8.dp),
                    supportingContent = {
                        Text("Capture a photo directly from Android.")
                    }
                )
                TextButton(
                    onClick = {
                        onSelectAction(AttachmentAction.TAKE_PHOTO)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                ) {
                    Text("Open camera")
                }
                HorizontalDivider(modifier = Modifier.padding(top = 8.dp))
            }

            item {
                ListItem(
                    headlineContent = {
                        Text("Choose photo")
                    },
                    leadingContent = {
                        Icon(Icons.Outlined.PhotoLibrary, contentDescription = null)
                    },
                    modifier = Modifier.padding(horizontal = 8.dp),
                    supportingContent = {
                        Text("Use the Android system photo picker.")
                    }
                )
                TextButton(
                    onClick = {
                        onSelectAction(AttachmentAction.CHOOSE_PHOTO)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                ) {
                    Text("Open photo picker")
                }
                HorizontalDivider(modifier = Modifier.padding(top = 8.dp))
            }

            item {
                ListItem(
                    headlineContent = {
                        Text("Choose file")
                    },
                    leadingContent = {
                        Icon(Icons.Outlined.AttachFile, contentDescription = null)
                    },
                    modifier = Modifier.padding(horizontal = 8.dp),
                    supportingContent = {
                        Text("Use the Android system document picker.")
                    }
                )
                TextButton(
                    onClick = {
                        onSelectAction(AttachmentAction.CHOOSE_FILE)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                ) {
                    Text("Open file picker")
                }
            }
        }
    }
}
