package com.flashcardsopensourceapp.feature.review

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Audiotrack
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil3.compose.SubcomposeAsyncImage
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAsset
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetDownloadUrl
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch

private val reviewManagedMediaIconSize = 22.dp
private val reviewManagedMediaActionIconSize = 18.dp
private val reviewManagedMediaImageMinimumHeight = 120.dp
private val reviewManagedMediaImageMaximumHeight = 360.dp

private enum class ReviewManagedMediaCategory {
    IMAGE,
    AUDIO,
    VIDEO,
    ATTACHMENT
}

private sealed interface ReviewManagedMediaDownloadState {
    data object Loading : ReviewManagedMediaDownloadState

    data class Ready(
        val downloadUrl: MediaAssetDownloadUrl
    ) : ReviewManagedMediaDownloadState

    data object Unavailable : ReviewManagedMediaDownloadState
}

private enum class ReviewManagedMediaAttachmentActionState {
    IDLE,
    OPENING,
    COPYING,
    UNAVAILABLE
}

@Composable
internal fun ReviewManagedMediaContent(
    reference: ReviewManagedMediaReference,
    onLoadManagedMediaDownloadUrl: suspend (String) -> MediaAssetDownloadUrl
) {
    val mediaAsset = reference.mediaAsset
    val category = classifyReviewManagedMediaCategory(
        mimeType = mediaAsset?.mimeType,
        isImageSyntax = reference.isImageSyntax
    )
    val isUnavailable = mediaAsset == null || mediaAsset.deletedAtMillis != null
    val categoryLabel = stringResource(id = reviewManagedMediaCategoryLabelResId(category = category))
    val label = reviewManagedMediaDisplayLabel(
        reference = reference,
        mediaAsset = mediaAsset,
        categoryLabel = categoryLabel
    )
    if (isUnavailable) {
        ReviewManagedMediaPlaceholderRow(
            label = label,
            supportingText = stringResource(id = R.string.review_media_unavailable),
            icon = Icons.Outlined.WarningAmber
        )
        return
    }

    when (category) {
        ReviewManagedMediaCategory.IMAGE -> ReviewDownloadableManagedMedia(
            mediaAsset = checkNotNull(mediaAsset),
            category = category,
            categoryLabel = categoryLabel,
            label = label,
            onLoadManagedMediaDownloadUrl = onLoadManagedMediaDownloadUrl
        )

        ReviewManagedMediaCategory.ATTACHMENT -> ReviewManagedMediaAttachment(
            mediaAssetId = checkNotNull(mediaAsset).mediaAssetId,
            label = label,
            categoryLabel = categoryLabel,
            onLoadManagedMediaDownloadUrl = onLoadManagedMediaDownloadUrl
        )

        ReviewManagedMediaCategory.AUDIO,
        ReviewManagedMediaCategory.VIDEO -> ReviewManagedMediaPlaceholderRow(
            label = label,
            supportingText = categoryLabel,
            icon = reviewManagedMediaCategoryIcon(category = category)
        )
    }
}

@Composable
private fun ReviewDownloadableManagedMedia(
    mediaAsset: MediaAsset,
    category: ReviewManagedMediaCategory,
    categoryLabel: String,
    label: String,
    onLoadManagedMediaDownloadUrl: suspend (String) -> MediaAssetDownloadUrl
) {
    val currentLoadManagedMediaDownloadUrl = rememberUpdatedState(newValue = onLoadManagedMediaDownloadUrl)
    val downloadState by produceState<ReviewManagedMediaDownloadState>(
        initialValue = ReviewManagedMediaDownloadState.Loading,
        key1 = mediaAsset.mediaAssetId,
        key2 = mediaAsset.updatedAtMillis,
        key3 = mediaAsset.deletedAtMillis
    ) {
        value = try {
            ReviewManagedMediaDownloadState.Ready(
                downloadUrl = currentLoadManagedMediaDownloadUrl.value(mediaAsset.mediaAssetId)
            )
        } catch (error: Throwable) {
            if (error is CancellationException) {
                throw error
            }
            ReviewManagedMediaDownloadState.Unavailable
        }
    }

    when (val state = downloadState) {
        ReviewManagedMediaDownloadState.Loading -> ReviewManagedMediaPlaceholderRow(
            label = label,
            supportingText = stringResource(id = R.string.review_media_loading),
            icon = reviewManagedMediaCategoryIcon(category = category)
        )

        ReviewManagedMediaDownloadState.Unavailable -> ReviewManagedMediaPlaceholderRow(
            label = label,
            supportingText = stringResource(id = R.string.review_media_unavailable),
            icon = Icons.Outlined.WarningAmber
        )

        is ReviewManagedMediaDownloadState.Ready -> when (category) {
            ReviewManagedMediaCategory.IMAGE -> ReviewManagedMediaImage(
                label = label,
                url = state.downloadUrl.url
            )

            ReviewManagedMediaCategory.ATTACHMENT -> ReviewManagedMediaAttachment(
                mediaAssetId = mediaAsset.mediaAssetId,
                label = label,
                categoryLabel = categoryLabel,
                onLoadManagedMediaDownloadUrl = onLoadManagedMediaDownloadUrl
            )

            ReviewManagedMediaCategory.AUDIO,
            ReviewManagedMediaCategory.VIDEO -> ReviewManagedMediaPlaceholderRow(
                label = label,
                supportingText = categoryLabel,
                icon = reviewManagedMediaCategoryIcon(category = category)
            )
        }
    }
}

@Composable
private fun ReviewManagedMediaImage(
    label: String,
    url: String
) {
    val context = LocalContext.current
    val imageRequest = remember(context, url) {
        ImageRequest.Builder(context)
            .data(url)
            .diskCachePolicy(CachePolicy.DISABLED)
            .build()
    }
    SubcomposeAsyncImage(
        model = imageRequest,
        contentDescription = label,
        contentScale = ContentScale.Fit,
        loading = {
            ReviewManagedMediaImageState(
                label = label,
                supportingText = stringResource(id = R.string.review_media_loading),
                icon = Icons.Outlined.Image,
                showProgress = true
            )
        },
        error = {
            ReviewManagedMediaImageState(
                label = label,
                supportingText = stringResource(id = R.string.review_media_unavailable),
                icon = Icons.Outlined.WarningAmber,
                showProgress = false
            )
        },
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(
                min = reviewManagedMediaImageMinimumHeight,
                max = reviewManagedMediaImageMaximumHeight
            )
            .clip(shape = MaterialTheme.shapes.medium)
            .background(color = MaterialTheme.colorScheme.surfaceContainerHighest)
    )
}

@Composable
private fun ReviewManagedMediaImageState(
    label: String,
    supportingText: String,
    icon: ImageVector,
    showProgress: Boolean
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp)
    ) {
        if (showProgress) {
            CircularProgressIndicator(
                modifier = Modifier.size(reviewManagedMediaIconSize)
            )
        } else {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(reviewManagedMediaIconSize)
            )
        }
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface
        )
        Text(
            text = supportingText,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun ReviewManagedMediaAttachment(
    mediaAssetId: String,
    label: String,
    categoryLabel: String,
    onLoadManagedMediaDownloadUrl: suspend (String) -> MediaAssetDownloadUrl
) {
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    val coroutineScope = rememberCoroutineScope()
    val currentLoadManagedMediaDownloadUrl = rememberUpdatedState(newValue = onLoadManagedMediaDownloadUrl)
    val currentMediaAssetId = rememberUpdatedState(newValue = mediaAssetId)
    var actionState by remember(mediaAssetId) {
        mutableStateOf(value = ReviewManagedMediaAttachmentActionState.IDLE)
    }
    var activeActionJob by remember {
        mutableStateOf<Job?>(value = null)
    }
    val clipboardManager = remember(context) {
        checkNotNull(context.getSystemService(ClipboardManager::class.java)) {
            "ClipboardManager is not available."
        }
    }
    DisposableEffect(mediaAssetId) {
        onDispose {
            activeActionJob?.cancel()
        }
    }
    val isActionRunning = actionState == ReviewManagedMediaAttachmentActionState.OPENING ||
        actionState == ReviewManagedMediaAttachmentActionState.COPYING
    val openAttachment = {
        if (actionState != ReviewManagedMediaAttachmentActionState.OPENING &&
            actionState != ReviewManagedMediaAttachmentActionState.COPYING
        ) {
            val actionMediaAssetId = mediaAssetId
            activeActionJob?.cancel()
            actionState = ReviewManagedMediaAttachmentActionState.OPENING
            activeActionJob = coroutineScope.launch {
                try {
                    val downloadUrl: MediaAssetDownloadUrl = currentLoadManagedMediaDownloadUrl.value(
                        actionMediaAssetId
                    )
                    currentCoroutineContext().ensureActive()
                    if (actionMediaAssetId != currentMediaAssetId.value) {
                        return@launch
                    }
                    uriHandler.openUri(uri = downloadUrl.url)
                    actionState = ReviewManagedMediaAttachmentActionState.IDLE
                } catch (error: Throwable) {
                    if (error is CancellationException) {
                        if (actionMediaAssetId == currentMediaAssetId.value) {
                            actionState = ReviewManagedMediaAttachmentActionState.IDLE
                        }
                        throw error
                    }
                    if (actionMediaAssetId == currentMediaAssetId.value) {
                        actionState = ReviewManagedMediaAttachmentActionState.UNAVAILABLE
                    }
                }
            }
        }
    }
    val copyAttachmentLink = {
        if (actionState != ReviewManagedMediaAttachmentActionState.OPENING &&
            actionState != ReviewManagedMediaAttachmentActionState.COPYING
        ) {
            val actionMediaAssetId = mediaAssetId
            val actionLabel = label
            activeActionJob?.cancel()
            actionState = ReviewManagedMediaAttachmentActionState.COPYING
            activeActionJob = coroutineScope.launch {
                try {
                    val downloadUrl: MediaAssetDownloadUrl = currentLoadManagedMediaDownloadUrl.value(
                        actionMediaAssetId
                    )
                    currentCoroutineContext().ensureActive()
                    if (actionMediaAssetId != currentMediaAssetId.value) {
                        return@launch
                    }
                    clipboardManager.setPrimaryClip(
                        ClipData.newPlainText(actionLabel, downloadUrl.url)
                    )
                    actionState = ReviewManagedMediaAttachmentActionState.IDLE
                } catch (error: Throwable) {
                    if (error is CancellationException) {
                        if (actionMediaAssetId == currentMediaAssetId.value) {
                            actionState = ReviewManagedMediaAttachmentActionState.IDLE
                        }
                        throw error
                    }
                    if (actionMediaAssetId == currentMediaAssetId.value) {
                        actionState = ReviewManagedMediaAttachmentActionState.UNAVAILABLE
                    }
                }
            }
        }
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .background(
                color = MaterialTheme.colorScheme.surfaceContainerHighest,
                shape = MaterialTheme.shapes.medium
            )
            .padding(12.dp)
    ) {
        Icon(
            imageVector = if (actionState == ReviewManagedMediaAttachmentActionState.UNAVAILABLE) {
                Icons.Outlined.WarningAmber
            } else {
                Icons.Outlined.AttachFile
            },
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(reviewManagedMediaIconSize)
        )
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.weight(weight = 1f)
        ) {
            Column(
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = if (actionState == ReviewManagedMediaAttachmentActionState.UNAVAILABLE) {
                        stringResource(id = R.string.review_media_unavailable)
                    } else {
                        categoryLabel
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                TextButton(
                    enabled = isActionRunning.not(),
                    onClick = openAttachment
                ) {
                    if (actionState == ReviewManagedMediaAttachmentActionState.OPENING) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(reviewManagedMediaActionIconSize),
                            strokeWidth = 2.dp
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Outlined.OpenInNew,
                            contentDescription = null,
                            modifier = Modifier.size(reviewManagedMediaActionIconSize)
                        )
                    }
                    Spacer(modifier = Modifier.size(4.dp))
                    Text(text = stringResource(id = R.string.review_media_open_attachment))
                }
                TextButton(
                    enabled = isActionRunning.not(),
                    onClick = copyAttachmentLink
                ) {
                    if (actionState == ReviewManagedMediaAttachmentActionState.COPYING) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(reviewManagedMediaActionIconSize),
                            strokeWidth = 2.dp
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Outlined.ContentCopy,
                            contentDescription = null,
                            modifier = Modifier.size(reviewManagedMediaActionIconSize)
                        )
                    }
                    Spacer(modifier = Modifier.size(4.dp))
                    Text(text = stringResource(id = R.string.review_media_copy_link))
                }
            }
        }
    }
}

@Composable
private fun ReviewManagedMediaPlaceholderRow(
    label: String,
    supportingText: String,
    icon: ImageVector
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .background(
                color = MaterialTheme.colorScheme.surfaceContainerHighest,
                shape = MaterialTheme.shapes.medium
            )
            .padding(12.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(reviewManagedMediaIconSize)
        )
        Column(
            verticalArrangement = Arrangement.spacedBy(2.dp),
            modifier = Modifier.weight(weight = 1f)
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                text = supportingText,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

private fun classifyReviewManagedMediaCategory(
    mimeType: String?,
    isImageSyntax: Boolean
): ReviewManagedMediaCategory {
    val normalizedMimeType = mimeType?.lowercase()
    return when {
        normalizedMimeType == null -> {
            if (isImageSyntax) {
                ReviewManagedMediaCategory.IMAGE
            } else {
                ReviewManagedMediaCategory.ATTACHMENT
            }
        }
        normalizedMimeType.startsWith(prefix = "image/") -> ReviewManagedMediaCategory.IMAGE
        normalizedMimeType.startsWith(prefix = "audio/") -> ReviewManagedMediaCategory.AUDIO
        normalizedMimeType.startsWith(prefix = "video/") -> ReviewManagedMediaCategory.VIDEO
        else -> ReviewManagedMediaCategory.ATTACHMENT
    }
}

private fun reviewManagedMediaCategoryIcon(category: ReviewManagedMediaCategory): ImageVector {
    return when (category) {
        ReviewManagedMediaCategory.IMAGE -> Icons.Outlined.Image
        ReviewManagedMediaCategory.AUDIO -> Icons.Outlined.Audiotrack
        ReviewManagedMediaCategory.VIDEO -> Icons.Outlined.Movie
        ReviewManagedMediaCategory.ATTACHMENT -> Icons.Outlined.AttachFile
    }
}

private fun reviewManagedMediaCategoryLabelResId(category: ReviewManagedMediaCategory): Int {
    return when (category) {
        ReviewManagedMediaCategory.IMAGE -> R.string.review_media_image_label
        ReviewManagedMediaCategory.AUDIO -> R.string.review_media_audio_label
        ReviewManagedMediaCategory.VIDEO -> R.string.review_media_video_label
        ReviewManagedMediaCategory.ATTACHMENT -> R.string.review_media_attachment_label
    }
}

private fun reviewManagedMediaDisplayLabel(
    reference: ReviewManagedMediaReference,
    mediaAsset: MediaAsset?,
    categoryLabel: String
): String {
    val explicitLabel = reference.label?.trim()
    if (explicitLabel != null && explicitLabel.isNotEmpty()) {
        return explicitLabel
    }

    val sourceUrl = mediaAsset?.sourceUrl
    if (sourceUrl != null) {
        val fileName = reviewManagedMediaFileName(sourceUrl = sourceUrl)
        if (fileName != null) {
            return fileName
        }
    }

    return categoryLabel
}

private fun reviewManagedMediaFileName(sourceUrl: String): String? {
    val lastPathComponent = sourceUrl
        .substringBefore(delimiter = "?")
        .substringBefore(delimiter = "#")
        .substringAfterLast(delimiter = "/")
        .trim()
    return lastPathComponent.ifEmpty { null }
}
