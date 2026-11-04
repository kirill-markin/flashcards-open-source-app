package com.flashcardsopensourceapp.feature.review

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Log
import coil3.ImageLoader
import coil3.memory.MemoryCache
import coil3.request.CachePolicy
import coil3.request.ErrorResult
import coil3.request.ImageRequest
import coil3.size.Dimension
import coil3.size.Precision
import coil3.size.Scale
import com.flashcardsopensourceapp.data.local.model.media.MediaAsset
import com.flashcardsopensourceapp.data.local.model.media.ReviewMediaAssetFile
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException
import kotlin.math.roundToInt

private const val reviewImagePreparerLogTag: String = "ReviewImagePreparer"
private const val reviewResolvedImageFilesMaxCount: Int = 64

internal data class ReviewResolvedImageFile(
    val mediaFile: ReviewMediaAssetFile,
    val imageAspectRatio: Float?
)

/**
 * Decodes the images of the current card and the next card's both sides into Coil's memory
 * cache, so they draw on the first frame after a rating or reveal.
 * See docs/fsrs-scheduling-logic.md#non-blocking-review.
 */
internal class ReviewImagePreparer(
    private val context: Context,
    private val imageLoader: ImageLoader,
    private val preparationScope: CoroutineScope,
    private val loadManagedMediaFile: suspend (String) -> ReviewMediaAssetFile
) {
    // Main thread only. A finished job stays until its image leaves the wanted set, so a failed
    // download is neither retried nor logged again on every rating while the image stays wanted.
    private val preparationJobsByMemoryCacheKey: MutableMap<String, Job> = mutableMapOf()

    private val resolvedImageFilesByMemoryCacheKey =
        object : LinkedHashMap<String, ReviewResolvedImageFile>(16, 0.75f, true) {
            override fun removeEldestEntry(
                eldest: MutableMap.MutableEntry<String, ReviewResolvedImageFile>
            ): Boolean {
                return size > reviewResolvedImageFilesMaxCount
            }
        }

    suspend fun resolveImageFile(mediaAssetId: String): ReviewResolvedImageFile {
        val mediaFile: ReviewMediaAssetFile = loadManagedMediaFile(mediaAssetId)
        val imageFile = ReviewResolvedImageFile(
            mediaFile = mediaFile,
            imageAspectRatio = readReviewImageAspectRatio(context = context, uri = mediaFile.uri)
        )
        synchronized(resolvedImageFilesByMemoryCacheKey) {
            resolvedImageFilesByMemoryCacheKey[
                reviewManagedMediaImageMemoryCacheKey(mediaAsset = mediaFile.mediaAsset)
            ] = imageFile
        }
        return imageFile
    }

    /** The file already resolved on disk, with its header bounds; its bitmap may still be decoding. */
    fun resolvedImageFile(mediaAsset: MediaAsset): ReviewResolvedImageFile? {
        return synchronized(resolvedImageFilesByMemoryCacheKey) {
            resolvedImageFilesByMemoryCacheKey[reviewManagedMediaImageMemoryCacheKey(mediaAsset = mediaAsset)]
        }
    }

    /** A file that failed to decode goes back through [resolveImageFile], which re-validates it on disk. */
    fun forgetResolvedImageFile(mediaAsset: MediaAsset) {
        synchronized(resolvedImageFilesByMemoryCacheKey) {
            resolvedImageFilesByMemoryCacheKey.remove(reviewManagedMediaImageMemoryCacheKey(mediaAsset = mediaAsset))
        }
    }

    private fun isImageMemoryCached(mediaAsset: MediaAsset): Boolean {
        val memoryCacheKey = MemoryCache.Key(key = reviewManagedMediaImageMemoryCacheKey(mediaAsset = mediaAsset))
        return imageLoader.memoryCache?.get(key = memoryCacheKey) != null
    }

    /**
     * Cancels only preparation whose image left [mediaAssets]; an image still wanted after a rating
     * keeps its in-flight download and decode instead of restarting it.
     */
    fun prepareOnly(mediaAssets: List<MediaAsset>) {
        val mediaAssetsByMemoryCacheKey: Map<String, MediaAsset> = mediaAssets.associateBy { mediaAsset ->
            reviewManagedMediaImageMemoryCacheKey(mediaAsset = mediaAsset)
        }
        val unwantedMemoryCacheKeys: Set<String> =
            preparationJobsByMemoryCacheKey.keys - mediaAssetsByMemoryCacheKey.keys
        unwantedMemoryCacheKeys.forEach { memoryCacheKey ->
            preparationJobsByMemoryCacheKey.remove(memoryCacheKey)?.cancel()
        }
        mediaAssetsByMemoryCacheKey.forEach { (memoryCacheKey, mediaAsset) ->
            preparationJobsByMemoryCacheKey.getOrPut(memoryCacheKey) {
                preparationScope.launch {
                    prepareImage(mediaAsset = mediaAsset)
                }
            }
        }
    }

    private suspend fun prepareImage(mediaAsset: MediaAsset) {
        if (resolvedImageFile(mediaAsset = mediaAsset) != null && isImageMemoryCached(mediaAsset = mediaAsset)) {
            return
        }

        try {
            val imageFile: ReviewResolvedImageFile = resolveImageFile(mediaAssetId = mediaAsset.mediaAssetId)
            val result = imageLoader.execute(
                request = reviewManagedMediaImageRequestBuilder(context = context, mediaFile = imageFile.mediaFile)
                    // Coil reuses a cached bitmap at least as large as the requested size, so decoding
                    // at the widest possible frame serves the on-screen request at any layout size.
                    .size(
                        width = Dimension(px = reviewManagedMediaImageMaxFrameWidthPx(context = context)),
                        height = Dimension.Undefined
                    )
                    .scale(Scale.FIT)
                    .precision(Precision.INEXACT)
                    .build()
            )
            if (result is ErrorResult) {
                logReviewImagePreparationFailure(mediaAssetId = mediaAsset.mediaAssetId, error = result.throwable)
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            // Best effort: the on-screen image loads and reports its own failure as before.
            logReviewImagePreparationFailure(mediaAssetId = mediaAsset.mediaAssetId, error = error)
        }
    }
}

/**
 * Images to decode ahead: the current card's back and both sides of the next card. The shown front
 * stays in the set so a rating does not cancel the preparation it started as the next card's front.
 */
internal fun reviewImageAssetsToPrepare(
    currentCard: PreparedReviewCardPresentation?,
    nextCard: PreparedReviewCardPresentation?
): List<MediaAsset> {
    return listOfNotNull(
        currentCard?.frontContent,
        currentCard?.backContent,
        nextCard?.frontContent,
        nextCard?.backContent
    )
        .flatMap { content -> reviewRenderedContentImageAssets(content = content) }
        .distinctBy { mediaAsset -> mediaAsset.mediaAssetId }
}

private fun reviewRenderedContentImageAssets(content: ReviewRenderedContent): List<MediaAsset> {
    if (content !is ReviewRenderedContent.ManagedMarkdown) {
        return emptyList()
    }

    return content.blocks.flatMap { block ->
        when (block) {
            is ReviewManagedMarkdownBlock.ManagedMedia -> listOfNotNull(
                reviewManagedMediaImageFileAsset(reference = block.reference)
            )
            is ReviewManagedMarkdownBlock.ManagedMediaGallery -> block.references.mapNotNull { reference ->
                reviewManagedMediaImageFileAsset(reference = reference)
            }
            is ReviewManagedMarkdownBlock.Markdown,
            is ReviewManagedMarkdownBlock.Formula -> emptyList()
        }
    }
}

/**
 * Shared by the preparer and the on-screen image: a different memory cache key would mean the
 * prepared bitmap is never reused.
 */
internal fun reviewManagedMediaImageRequestBuilder(
    context: Context,
    mediaFile: ReviewMediaAssetFile
): ImageRequest.Builder {
    return ImageRequest.Builder(context)
        .data(mediaFile.uri)
        .memoryCacheKey(reviewManagedMediaImageMemoryCacheKey(mediaAsset = mediaFile.mediaAsset))
        .diskCachePolicy(CachePolicy.DISABLED)
}

internal fun reviewManagedMediaImageMemoryCacheKey(mediaAsset: MediaAsset): String {
    return "review-managed-media:${mediaAsset.mediaAssetId}:${mediaAsset.sha256}"
}

private fun reviewManagedMediaImageMaxFrameWidthPx(context: Context): Int {
    val resources = context.resources
    val maxFrameWidthDp: Float = minOf(
        resources.configuration.screenWidthDp.toFloat(),
        reviewManagedMediaImageMaxWidth.value
    )
    return (maxFrameWidthDp * resources.displayMetrics.density).roundToInt()
}

private suspend fun readReviewImageAspectRatio(
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
            reviewImageAspectRatio(width = options.outWidth, height = options.outHeight)
        } catch (error: IOException) {
            null
        } catch (error: SecurityException) {
            null
        } catch (error: IllegalArgumentException) {
            null
        }
    }
}

private fun reviewImageAspectRatio(
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

private fun logReviewImagePreparationFailure(
    mediaAssetId: String,
    error: Throwable
) {
    Log.w(
        reviewImagePreparerLogTag,
        "event=review_image_prepare_failed mediaAssetId=$mediaAssetId " +
            "errorType=${error::class.java.simpleName} error=${error.message}",
        error
    )
}
