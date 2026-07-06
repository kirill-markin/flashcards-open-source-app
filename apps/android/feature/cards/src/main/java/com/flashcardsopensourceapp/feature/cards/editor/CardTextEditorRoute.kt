package com.flashcardsopensourceapp.feature.cards.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.AddPhotoAlternate
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.SubcomposeAsyncImage
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import com.flashcardsopensourceapp.feature.cards.R
import com.flashcardsopensourceapp.feature.cards.cardTextEditorAddMediaButtonTag
import com.flashcardsopensourceapp.feature.cards.cardTextEditorManagedMediaPreviewItemTag
import com.flashcardsopensourceapp.feature.cards.cardTextEditorManagedMediaPreviewStripTag
import kotlinx.coroutines.CancellationException

private sealed interface CardEditorManagedImagePreviewState {
    data object Loading : CardEditorManagedImagePreviewState
    data class Ready(val uri: String) : CardEditorManagedImagePreviewState
    data object Unavailable : CardEditorManagedImagePreviewState
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CardTextEditorRoute(
    title: String,
    supportingText: String,
    text: String,
    selection: CardEditorTextSelection,
    managedImageReferences: List<CardEditorManagedImageReference>,
    textFieldTag: String,
    isAddingMedia: Boolean,
    onTextChange: (String, CardEditorTextSelection) -> Unit,
    onSelectionChange: (CardEditorTextSelection) -> Unit,
    onInsertImage: () -> Unit,
    onRemoveManagedImageReference: (String) -> Unit,
    onLoadManagedImageUri: suspend (String) -> String,
    onBack: () -> Unit
) {
    val addingImageContentDescription = stringResource(
        id = R.string.cards_editor_adding_image_content_description
    )
    var textFieldValue by rememberSaveable(stateSaver = TextFieldValue.Saver) {
        mutableStateOf(
            value = TextFieldValue(
                text,
                textRangeFromCardSelection(selection = selection, text = text)
            )
        )
    }
    val latestTextRange = textRangeFromCardSelection(selection = selection, text = text)
    LaunchedEffect(text, latestTextRange) {
        if (textFieldValue.text != text || textFieldValue.selection != latestTextRange) {
            textFieldValue = TextFieldValue(
                text,
                latestTextRange
            )
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(title)
                },
                actions = {
                    IconButton(
                        onClick = onInsertImage,
                        enabled = isAddingMedia.not(),
                        modifier = Modifier.testTag(cardTextEditorAddMediaButtonTag)
                    ) {
                        if (isAddingMedia) {
                            CircularProgressIndicator(
                                modifier = Modifier
                                    .size(24.dp)
                                    .semantics {
                                        contentDescription = addingImageContentDescription
                                    }
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Outlined.AddPhotoAlternate,
                                contentDescription = stringResource(
                                    id = R.string.cards_editor_add_image_content_description
                                )
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(id = R.string.cards_editor_back_content_description)
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        Column(
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier
                .fillMaxSize()
                .padding(
                    start = 16.dp,
                    top = innerPadding.calculateTopPadding() + 16.dp,
                    end = 16.dp,
                    bottom = innerPadding.calculateBottomPadding() + 16.dp
                )
        ) {
            Text(
                text = supportingText,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            if (managedImageReferences.isNotEmpty()) {
                CardEditorManagedImagePreviewStrip(
                    references = managedImageReferences,
                    onRemoveManagedImageReference = onRemoveManagedImageReference,
                    onLoadManagedImageUri = onLoadManagedImageUri
                )
            }

            OutlinedTextField(
                value = textFieldValue,
                onValueChange = { nextValue ->
                    textFieldValue = nextValue
                    val nextSelection = cardSelectionFromTextRange(
                        range = nextValue.selection,
                        text = nextValue.text
                    )
                    if (nextValue.text != text) {
                        onTextChange(nextValue.text, nextSelection)
                    } else if (nextSelection != selection) {
                        onSelectionChange(nextSelection)
                    }
                },
                label = {
                    Text(title)
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .testTag(textFieldTag),
                minLines = 14
            )
        }
    }
}

@Composable
private fun CardEditorManagedImagePreviewStrip(
    references: List<CardEditorManagedImageReference>,
    onRemoveManagedImageReference: (String) -> Unit,
    onLoadManagedImageUri: suspend (String) -> String
) {
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .testTag(cardTextEditorManagedMediaPreviewStripTag)
    ) {
        items(
            items = references,
            key = CardEditorManagedImageReference::referenceKey
        ) { reference ->
            CardEditorManagedImagePreviewItem(
                reference = reference,
                onRemoveManagedImageReference = onRemoveManagedImageReference,
                onLoadManagedImageUri = onLoadManagedImageUri
            )
        }
    }
}

@Composable
private fun CardEditorManagedImagePreviewItem(
    reference: CardEditorManagedImageReference,
    onRemoveManagedImageReference: (String) -> Unit,
    onLoadManagedImageUri: suspend (String) -> String
) {
    val currentLoadManagedImageUri = rememberUpdatedState(newValue = onLoadManagedImageUri)
    val previewState by produceState<CardEditorManagedImagePreviewState>(
        initialValue = CardEditorManagedImagePreviewState.Loading,
        key1 = reference.mediaAssetId
    ) {
        value = try {
            CardEditorManagedImagePreviewState.Ready(
                uri = currentLoadManagedImageUri.value(reference.mediaAssetId)
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            CardEditorManagedImagePreviewState.Unavailable
        }
    }
    val label = reference.label ?: stringResource(id = R.string.cards_editor_image_label)

    Card(
        modifier = Modifier
            .width(184.dp)
            .testTag(cardTextEditorManagedMediaPreviewItemTag(mediaAssetId = reference.mediaAssetId))
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(12.dp)
        ) {
            CardEditorManagedImagePreviewSurface(
                state = previewState,
                mediaAssetId = reference.mediaAssetId,
                label = label
            )
            Text(
                text = label,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyMedium
            )
            TextButton(
                onClick = {
                    onRemoveManagedImageReference(reference.referenceKey)
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(
                    imageVector = Icons.Outlined.Close,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(text = stringResource(id = R.string.cards_editor_remove_image))
            }
        }
    }
}

@Composable
private fun CardEditorManagedImagePreviewSurface(
    state: CardEditorManagedImagePreviewState,
    mediaAssetId: String,
    label: String
) {
    when (state) {
        CardEditorManagedImagePreviewState.Loading -> CardEditorManagedImagePlaceholder(
            label = stringResource(id = R.string.cards_editor_image_loading),
            isLoading = true
        )

        CardEditorManagedImagePreviewState.Unavailable -> CardEditorManagedImagePlaceholder(
            label = stringResource(id = R.string.cards_editor_image_unavailable),
            isLoading = false
        )

        is CardEditorManagedImagePreviewState.Ready -> CardEditorManagedImage(
            uri = state.uri,
            mediaAssetId = mediaAssetId,
            label = label
        )
    }
}

@Composable
private fun CardEditorManagedImage(
    uri: String,
    mediaAssetId: String,
    label: String
) {
    val context = LocalContext.current
    val memoryCacheKey = remember(mediaAssetId, uri) {
        cardEditorManagedImageMemoryCacheKey(mediaAssetId = mediaAssetId, uri = uri)
    }

    key(memoryCacheKey) {
        val imageRequest = remember(context, uri) {
            ImageRequest.Builder(context)
                .data(uri)
                .memoryCacheKey(memoryCacheKey)
                .diskCachePolicy(CachePolicy.DISABLED)
                .build()
        }
        SubcomposeAsyncImage(
            model = imageRequest,
            contentDescription = label,
            contentScale = ContentScale.Crop,
            loading = {
                CardEditorManagedImagePlaceholder(
                    label = stringResource(id = R.string.cards_editor_image_loading),
                    isLoading = true
                )
            },
            error = {
                CardEditorManagedImagePlaceholder(
                    label = stringResource(id = R.string.cards_editor_image_unavailable),
                    isLoading = false
                )
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(104.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(color = MaterialTheme.colorScheme.surfaceContainerHighest)
        )
    }
}

private fun cardEditorManagedImageMemoryCacheKey(
    mediaAssetId: String,
    uri: String
): String {
    return "card-editor-managed-media:$mediaAssetId:$uri"
}

@Composable
private fun CardEditorManagedImagePlaceholder(
    label: String,
    isLoading: Boolean
) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 104.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(color = MaterialTheme.colorScheme.surfaceContainerHighest)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(12.dp)
        ) {
            if (isLoading) {
                CircularProgressIndicator(modifier = Modifier.size(24.dp))
            } else {
                Icon(
                    imageVector = Icons.Outlined.WarningAmber,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(24.dp)
                )
            }
            Icon(
                imageVector = Icons.Outlined.Image,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp)
            )
            Text(
                text = label,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

private fun textRangeFromCardSelection(
    selection: CardEditorTextSelection,
    text: String
): TextRange {
    return TextRange(
        selection.start.coerceIn(minimumValue = 0, maximumValue = text.length),
        selection.end.coerceIn(minimumValue = 0, maximumValue = text.length)
    )
}

private fun cardSelectionFromTextRange(
    range: TextRange,
    text: String
): CardEditorTextSelection {
    val start = range.min.coerceIn(minimumValue = 0, maximumValue = text.length)
    val end = range.max.coerceIn(minimumValue = 0, maximumValue = text.length)
    return CardEditorTextSelection(start = start, end = end)
}
