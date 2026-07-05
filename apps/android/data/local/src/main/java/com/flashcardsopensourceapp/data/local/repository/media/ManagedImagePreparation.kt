package com.flashcardsopensourceapp.data.local.repository.media

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.drawable.AnimatedImageDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import com.flashcardsopensourceapp.data.local.model.media.normalizeMediaSha256
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.Locale

internal const val managedImageMimeType: String = "image/jpeg"

private const val managedImageMaxSidePixels: Int = 1_200
private const val managedImageJpegQuality: Int = 82
private const val managedImageFlattenBackgroundRed: Int = 0xf1
private const val managedImageFlattenBackgroundGreen: Int = 0xf3
private const val managedImageFlattenBackgroundBlue: Int = 0xf4

private val unsupportedManagedImageMimeTypes: Set<String> = setOf(
    "image/gif",
    "image/heic-sequence",
    "image/heif-sequence",
    "image/avif-sequence"
)

class ManagedMediaAuthoringImportException(
    message: String,
    cause: Throwable?
) : Exception(message, cause)

internal data class PreparedManagedImage(
    val mimeType: String,
    val bytes: ByteArray,
    val sizeBytes: Long,
    val sha256: String
) {
    init {
        require(mimeType == managedImageMimeType) {
            "Prepared managed image mimeType must be '$managedImageMimeType'."
        }
        require(bytes.isNotEmpty()) {
            "Prepared managed image bytes must not be empty."
        }
        require(sizeBytes == bytes.size.toLong()) {
            "Prepared managed image sizeBytes must match bytes size."
        }
        require(sha256 == normalizeMediaSha256(rawSha256 = sha256)) {
            "Prepared managed image sha256 must already be normalized."
        }
    }
}

internal suspend fun prepareManagedImageFromUri(
    contentResolver: ContentResolver,
    uri: Uri,
    ioDispatcher: CoroutineDispatcher
): PreparedManagedImage {
    return withContext(ioDispatcher) {
        prepareManagedImageFromUriBlocking(
            contentResolver = contentResolver,
            uri = uri
        )
    }
}

private fun prepareManagedImageFromUriBlocking(
    contentResolver: ContentResolver,
    uri: Uri
): PreparedManagedImage {
    return try {
        val resolverMimeType: String? = contentResolver.getType(uri)
        requireSupportedManagedImageMimeType(mimeType = resolverMimeType)

        val source: ImageDecoder.Source = ImageDecoder.createSource(contentResolver, uri)
        val drawable: Drawable = ImageDecoder.decodeDrawable(source) { decoder, info, _ ->
            requireSupportedManagedImageMimeType(mimeType = info.mimeType)
            if (info.isAnimated) {
                throw ManagedMediaAuthoringImportException(
                    message = "Animated images are not supported. Select a still image.",
                    cause = null
                )
            }
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            val dimensions: ManagedImageDimensions = scaledManagedImageDimensions(
                width = info.size.width,
                height = info.size.height,
                maxSidePixels = managedImageMaxSidePixels
            )
            decoder.setTargetSize(dimensions.width, dimensions.height)
        }
        if (drawable is AnimatedImageDrawable) {
            throw ManagedMediaAuthoringImportException(
                message = "Animated images are not supported. Select a still image.",
                cause = null
            )
        }

        val dimensions: ManagedImageDimensions = requireDecodedDrawableDimensions(drawable = drawable)
        val flattenedBitmap: Bitmap = flattenDrawableToBitmap(
            drawable = drawable,
            dimensions = dimensions
        )
        val jpegBytes: ByteArray = try {
            compressBitmapToManagedJpegBytes(bitmap = flattenedBitmap)
        } finally {
            flattenedBitmap.recycle()
        }
        val sha256: String = normalizeMediaSha256(rawSha256 = sha256Hex(bytes = jpegBytes))
        PreparedManagedImage(
            mimeType = managedImageMimeType,
            bytes = jpegBytes,
            sizeBytes = jpegBytes.size.toLong(),
            sha256 = sha256
        )
    } catch (error: ManagedMediaAuthoringImportException) {
        throw error
    } catch (error: SecurityException) {
        throw ManagedMediaAuthoringImportException(
            message = "Cannot read the selected image. Grant photo access and try again.",
            cause = error
        )
    } catch (error: IOException) {
        throw ManagedMediaAuthoringImportException(
            message = "Cannot read the selected image. Select a different image and try again.",
            cause = error
        )
    } catch (error: IllegalArgumentException) {
        throw ManagedMediaAuthoringImportException(
            message = "Cannot prepare the selected image because its data is invalid.",
            cause = error
        )
    }
}

private data class ManagedImageDimensions(
    val width: Int,
    val height: Int
) {
    init {
        require(width > 0) {
            "Managed image width must be positive."
        }
        require(height > 0) {
            "Managed image height must be positive."
        }
    }
}

private fun scaledManagedImageDimensions(
    width: Int,
    height: Int,
    maxSidePixels: Int
): ManagedImageDimensions {
    require(width > 0 && height > 0) {
        "Selected image dimensions must be positive."
    }
    require(maxSidePixels > 0) {
        "Managed image max side pixels must be positive."
    }

    val longestSide: Int = maxOf(width, height)
    if (longestSide <= maxSidePixels) {
        return ManagedImageDimensions(width = width, height = height)
    }

    val scale: Double = maxSidePixels.toDouble() / longestSide.toDouble()
    return ManagedImageDimensions(
        width = maxOf(1, kotlin.math.round(width.toDouble() * scale).toInt()),
        height = maxOf(1, kotlin.math.round(height.toDouble() * scale).toInt())
    )
}

private fun requireDecodedDrawableDimensions(drawable: Drawable): ManagedImageDimensions {
    val width: Int = drawable.intrinsicWidth
    val height: Int = drawable.intrinsicHeight
    if (width <= 0 || height <= 0) {
        throw ManagedMediaAuthoringImportException(
            message = "Cannot prepare the selected image because its dimensions are invalid.",
            cause = null
        )
    }
    return ManagedImageDimensions(width = width, height = height)
}

private fun flattenDrawableToBitmap(
    drawable: Drawable,
    dimensions: ManagedImageDimensions
): Bitmap {
    val bitmap: Bitmap = Bitmap.createBitmap(
        dimensions.width,
        dimensions.height,
        Bitmap.Config.ARGB_8888
    )
    val canvas = Canvas(bitmap)
    canvas.drawColor(
        Color.rgb(
            managedImageFlattenBackgroundRed,
            managedImageFlattenBackgroundGreen,
            managedImageFlattenBackgroundBlue
        )
    )
    drawable.setBounds(0, 0, dimensions.width, dimensions.height)
    drawable.draw(canvas)
    return bitmap
}

private fun compressBitmapToManagedJpegBytes(bitmap: Bitmap): ByteArray {
    val outputStream = ByteArrayOutputStream()
    val didCompress: Boolean = bitmap.compress(
        Bitmap.CompressFormat.JPEG,
        managedImageJpegQuality,
        outputStream
    )
    if (didCompress.not()) {
        throw ManagedMediaAuthoringImportException(
            message = "Cannot encode the selected image as JPEG.",
            cause = null
        )
    }

    val bytes: ByteArray = outputStream.toByteArray()
    if (bytes.isEmpty()) {
        throw ManagedMediaAuthoringImportException(
            message = "Cannot encode the selected image because JPEG output is empty.",
            cause = null
        )
    }
    return bytes
}

private fun requireSupportedManagedImageMimeType(mimeType: String?) {
    val normalizedMimeType: String = mimeType
        ?.substringBefore(delimiter = ';')
        ?.trim()
        ?.lowercase(Locale.US)
        ?: return
    if (normalizedMimeType.isEmpty() || normalizedMimeType == "application/octet-stream") {
        return
    }
    if (normalizedMimeType.startsWith(prefix = "image/").not()) {
        throw ManagedMediaAuthoringImportException(
            message = "The selected file is not an image.",
            cause = null
        )
    }
    if (unsupportedManagedImageMimeTypes.contains(normalizedMimeType)) {
        throw ManagedMediaAuthoringImportException(
            message = "Animated or multipage images are not supported. Select a still image.",
            cause = null
        )
    }
}

private fun sha256Hex(bytes: ByteArray): String {
    return encodeDigestHex(bytes = MessageDigest.getInstance("SHA-256").digest(bytes))
}

private fun encodeDigestHex(bytes: ByteArray): String {
    val hexChars: CharArray = "0123456789abcdef".toCharArray()
    val result = CharArray(size = bytes.size * 2)
    bytes.forEachIndexed { index, byte ->
        val value: Int = byte.toInt() and 0xff
        result[index * 2] = hexChars[value ushr 4]
        result[(index * 2) + 1] = hexChars[value and 0x0f]
    }
    return String(result)
}
