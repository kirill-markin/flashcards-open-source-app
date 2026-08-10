package com.flashcardsopensourceapp.feature.review

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.runtime.key
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
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil3.compose.SubcomposeAsyncImage
import coil3.compose.SubcomposeAsyncImageContent
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAsset
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetDownloadUrl
import com.flashcardsopensourceapp.data.local.model.media.ManagedMediaReferenceState
import com.flashcardsopensourceapp.data.local.model.media.ReviewMediaAssetFile
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

private val reviewManagedMediaIconSize = 22.dp
private val reviewManagedMediaActionIconSize = 18.dp
private val reviewManagedMediaImageMaxWidth = 520.dp
private const val reviewManagedMediaImagePlaceholderAspectRatio = 4f / 3f
private val reviewManagedMediaImagePlaceholderHeight = 180.dp
private val reviewManagedMediaSurfaceCornerRadius = 12.dp
private val reviewManagedMediaImageCornerRadius = 6.dp

private enum class ReviewManagedMediaCategory {
    IMAGE,
    AUDIO,
    VIDEO,
    ATTACHMENT
}

private enum class ReviewManagedMediaImageStateStyle {
    PROGRESS,
    WARNING
}

private sealed interface ReviewManagedMediaFileState {
    data object Loading : ReviewManagedMediaFileState

    data class Ready(
        val mediaFile: ReviewMediaAssetFile,
        val imageAspectRatio: Float?
    ) : ReviewManagedMediaFileState

    data object Unavailable : ReviewManagedMediaFileState
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
    onLoadManagedMediaFile: suspend (String) -> ReviewMediaAssetFile,
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
    when (reference.state) {
        ManagedMediaReferenceState.PENDING -> {
            val supportingText = stringResource(id = R.string.review_media_processing)
            ReviewManagedMediaImageState(
                label = label,
                supportingText = supportingText,
                accessibilityLabel = stringResource(
                    id = R.string.review_media_status_content_description,
                    label,
                    supportingText
                ),
                style = ReviewManagedMediaImageStateStyle.PROGRESS,
                modifier = Modifier.reviewManagedMediaImageFrame(
                    sizeModifier = Modifier.aspectRatio(ratio = reviewManagedMediaImagePlaceholderAspectRatio)
                )
            )
            return
        }

        ManagedMediaReferenceState.FAILED -> {
            val supportingText = stringResource(id = R.string.review_media_processing_failed)
            ReviewManagedMediaImageState(
                label = label,
                supportingText = supportingText,
                accessibilityLabel = stringResource(
                    id = R.string.review_media_status_content_description,
                    label,
                    supportingText
                ),
                style = ReviewManagedMediaImageStateStyle.WARNING,
                modifier = Modifier.reviewManagedMediaImageFrame(
                    sizeModifier = Modifier.aspectRatio(ratio = reviewManagedMediaImagePlaceholderAspectRatio)
                )
            )
            return
        }

        ManagedMediaReferenceState.READY -> Unit
    }
    if (isUnavailable) {
        ReviewManagedMediaPlaceholderRow(
            label = label,
            supportingText = stringResource(id = R.string.review_media_unavailable),
            icon = Icons.Outlined.WarningAmber
        )
        return
    }

    when (category) {
        ReviewManagedMediaCategory.IMAGE -> ReviewManagedMediaImageFile(
            mediaAsset = checkNotNull(mediaAsset),
            label = label,
            onLoadManagedMediaFile = onLoadManagedMediaFile
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
private fun ReviewManagedMediaImageFile(
    mediaAsset: MediaAsset,
    label: String,
    onLoadManagedMediaFile: suspend (String) -> ReviewMediaAssetFile
) {
    val context = LocalContext.current
    val currentLoadManagedMediaFile = rememberUpdatedState(newValue = onLoadManagedMediaFile)
    val mediaFileState by produceState<ReviewManagedMediaFileState>(
        initialValue = ReviewManagedMediaFileState.Loading,
        key1 = mediaAsset.mediaAssetId,
        key2 = mediaAsset.updatedAtMillis,
        key3 = mediaAsset.deletedAtMillis
    ) {
        value = try {
            val mediaFile: ReviewMediaAssetFile = currentLoadManagedMediaFile.value(mediaAsset.mediaAssetId)
            ReviewManagedMediaFileState.Ready(
                mediaFile = mediaFile,
                imageAspectRatio = reviewManagedMediaImageAspectRatio(context = context, uri = mediaFile.uri)
            )
        } catch (error: Throwable) {
            if (error is CancellationException) {
                throw error
            }
            ReviewManagedMediaFileState.Unavailable
        }
    }

    when (val state = mediaFileState) {
        ReviewManagedMediaFileState.Loading -> {
            val supportingText = stringResource(id = R.string.review_media_loading)
            ReviewManagedMediaImageState(
                label = label,
                supportingText = supportingText,
                accessibilityLabel = stringResource(
                    id = R.string.review_media_status_content_description,
                    label,
                    supportingText
                ),
                style = ReviewManagedMediaImageStateStyle.PROGRESS,
                modifier = Modifier.reviewManagedMediaImageFrame(
                    sizeModifier = Modifier.aspectRatio(ratio = reviewManagedMediaImagePlaceholderAspectRatio)
                )
            )
        }

        ReviewManagedMediaFileState.Unavailable -> {
            val supportingText = stringResource(id = R.string.review_media_unavailable)
            ReviewManagedMediaImageState(
                label = label,
                supportingText = supportingText,
                accessibilityLabel = stringResource(
                    id = R.string.review_media_status_content_description,
                    label,
                    supportingText
                ),
                style = ReviewManagedMediaImageStateStyle.WARNING,
                modifier = Modifier.reviewManagedMediaImageFrame(
                    sizeModifier = Modifier.aspectRatio(ratio = reviewManagedMediaImagePlaceholderAspectRatio)
                )
            )
        }

        is ReviewManagedMediaFileState.Ready -> ReviewManagedMediaImage(
            label = label,
            mediaAssetId = state.mediaFile.mediaAsset.mediaAssetId,
            sha256 = state.mediaFile.mediaAsset.sha256,
            uri = state.mediaFile.uri,
            imageAspectRatio = state.imageAspectRatio
        )
    }
}

@Composable
private fun ReviewManagedMediaImage(
    label: String,
    mediaAssetId: String,
    sha256: String,
    uri: String,
    imageAspectRatio: Float?
) {
    val context = LocalContext.current
    val memoryCacheKey = remember(mediaAssetId, sha256) {
        reviewManagedMediaImageMemoryCacheKey(mediaAssetId = mediaAssetId, sha256 = sha256)
    }

    key(memoryCacheKey) {
        val imageSizeModifier: Modifier = if (imageAspectRatio != null) {
            Modifier.aspectRatio(ratio = imageAspectRatio)
        } else {
            Modifier.height(reviewManagedMediaImagePlaceholderHeight)
        }
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
            contentScale = ContentScale.Fit,
            loading = {
                val supportingText = stringResource(id = R.string.review_media_loading)
                ReviewManagedMediaImageState(
                    label = label,
                    supportingText = supportingText,
                    accessibilityLabel = stringResource(
                        id = R.string.review_media_status_content_description,
                        label,
                        supportingText
                    ),
                    style = ReviewManagedMediaImageStateStyle.PROGRESS,
                    modifier = Modifier.fillMaxSize()
                )
            },
            success = {
                SubcomposeAsyncImageContent(
                    modifier = Modifier
                        .fillMaxSize()
                        .clip(shape = RoundedCornerShape(reviewManagedMediaImageCornerRadius))
                )
            },
            error = {
                val supportingText = stringResource(id = R.string.review_media_unavailable)
                ReviewManagedMediaImageState(
                    label = label,
                    supportingText = supportingText,
                    accessibilityLabel = stringResource(
                        id = R.string.review_media_status_content_description,
                        label,
                        supportingText
                    ),
                    style = ReviewManagedMediaImageStateStyle.WARNING,
                    modifier = Modifier.fillMaxSize()
                )
            },
            modifier = Modifier.reviewManagedMediaImageFrame(sizeModifier = imageSizeModifier)
        )
    }
}

private fun Modifier.reviewManagedMediaImageFrame(sizeModifier: Modifier): Modifier {
    return fillMaxWidth()
        .wrapContentWidth(
            align = Alignment.CenterHorizontally,
            unbounded = false
        )
        .widthIn(max = reviewManagedMediaImageMaxWidth)
        .fillMaxWidth()
        .then(sizeModifier)
}

private fun reviewManagedMediaImageMemoryCacheKey(
    mediaAssetId: String,
    sha256: String
): String {
    return "review-managed-media:$mediaAssetId:$sha256"
}

private suspend fun reviewManagedMediaImageAspectRatio(
    context: Context,
    uri: String
): Float? {
    return withContext(Dispatchers.IO) {
        val options = BitmapFactory.Options().apply {
            inJustDecodeBounds = true
        }
        try {
            context.contentResolver.openInputStream(Uri.parse(uri)).use { inputStream ->
                if (inputStream == null) {
                    return@withContext null
                }
                BitmapFactory.decodeStream(inputStream, null, options)
            }
            reviewManagedMediaImageAspectRatio(width = options.outWidth, height = options.outHeight)
        } catch (error: IOException) {
            null
        } catch (error: SecurityException) {
            null
        } catch (error: IllegalArgumentException) {
            null
        }
    }
}

private fun reviewManagedMediaImageAspectRatio(
    width: Int,
    height: Int
): Float? {
    if (width <= 0 || height <= 0) {
        return null
    }

    val aspectRatio: Float = width.toFloat() / height.toFloat()
    if (aspectRatio.isFinite().not()) {
        return null
    }

    return aspectRatio
}

@Composable
private fun ReviewManagedMediaImageState(
    label: String,
    supportingText: String,
    accessibilityLabel: String,
    style: ReviewManagedMediaImageStateStyle,
    modifier: Modifier
) {
    val containerColor = when (style) {
        ReviewManagedMediaImageStateStyle.PROGRESS -> MaterialTheme.colorScheme.surfaceContainerHighest
        ReviewManagedMediaImageStateStyle.WARNING -> MaterialTheme.colorScheme.errorContainer
    }
    val contentColor = when (style) {
        ReviewManagedMediaImageStateStyle.PROGRESS -> MaterialTheme.colorScheme.onSurfaceVariant
        ReviewManagedMediaImageStateStyle.WARNING -> MaterialTheme.colorScheme.onErrorContainer
    }
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = modifier
            .clearAndSetSemantics {
                contentDescription = accessibilityLabel
                if (style == ReviewManagedMediaImageStateStyle.PROGRESS) {
                    progressBarRangeInfo = ProgressBarRangeInfo.Indeterminate
                }
            }
            .background(
                color = containerColor,
                shape = RoundedCornerShape(reviewManagedMediaSurfaceCornerRadius)
            )
            .padding(16.dp)
    ) {
        when (style) {
            ReviewManagedMediaImageStateStyle.PROGRESS -> CircularProgressIndicator(
                color = contentColor,
                modifier = Modifier.size(reviewManagedMediaIconSize)
            )

            ReviewManagedMediaImageStateStyle.WARNING -> Icon(
                imageVector = Icons.Outlined.WarningAmber,
                contentDescription = null,
                tint = contentColor,
                modifier = Modifier.size(reviewManagedMediaIconSize)
            )
        }
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = contentColor
        )
        Text(
            text = supportingText,
            style = MaterialTheme.typography.bodySmall,
            color = contentColor
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
                shape = RoundedCornerShape(reviewManagedMediaSurfaceCornerRadius)
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
                shape = RoundedCornerShape(reviewManagedMediaSurfaceCornerRadius)
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
