package com.flashcardsopensourceapp.feature.ai.input

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.media.MediaRecorder
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import com.flashcardsopensourceapp.data.local.model.ai.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.ai.aiChatMaximumAttachmentBytes
import com.flashcardsopensourceapp.data.local.model.ai.aiChatSupportedFileExtensions
import com.flashcardsopensourceapp.data.local.model.ai.canonicalAiChatAttachmentMediaTypeForExtension
import com.flashcardsopensourceapp.data.local.model.ai.makeAiChatAttachment
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiDictationNoSpeechException
import com.flashcardsopensourceapp.feature.ai.strings.AiTextProvider
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.util.UUID

private const val cameraAttachmentFileName: String = "photo.jpg"
private const val cameraAttachmentMediaType: String = "image/jpeg"
private const val imageAttachmentMaxSidePixels: Int = 2_048
private const val imageAttachmentCompressionQuality: Int = 80
private const val imageAttachmentFallbackMaxSidePixels: Int = 1_280
private const val imageAttachmentFallbackCompressionQuality: Int = 55
private const val dictationFileName: String = "chat-dictation.m4a"
private const val dictationMediaType: String = "audio/mp4"
private const val dictationOutputExtension: String = "m4a"

data class RecordedAiChatAudio(
    val fileName: String,
    val mediaType: String,
    val audioBytes: ByteArray
)

class AiAttachmentImportUserException(
    message: String,
    cause: Throwable?
) : Exception(message, cause)

class AndroidAiChatDictationRecorder(
    private val context: Context,
    private val textProvider: AiTextProvider
) {
    private var mediaRecorder: MediaRecorder? = null
    private var outputFile: File? = null

    fun startRecording() {
        cancelRecording()

        val nextOutputFile = File(
            context.cacheDir,
            "ai-chat-dictation-${UUID.randomUUID()}.$dictationOutputExtension"
        )
        val recorder = MediaRecorder(context)

        try {
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            recorder.setAudioEncodingBitRate(128_000)
            recorder.setAudioSamplingRate(44_100)
            recorder.setOutputFile(nextOutputFile.absolutePath)
            recorder.prepare()
            recorder.start()
        } catch (error: Exception) {
            recorder.release()
            nextOutputFile.delete()
            throw error
        }

        mediaRecorder = recorder
        outputFile = nextOutputFile
    }

    fun stopRecording(): RecordedAiChatAudio {
        val recorder = requireNotNull(mediaRecorder) {
            textProvider.dictationRecordingNotActive
        }
        val recordedFile = requireNotNull(outputFile) {
            textProvider.dictationRecordingFileMissing
        }

        val stopFailure = try {
            recorder.stop()
            null
        } catch (error: RuntimeException) {
            error
        } finally {
            recorder.release()
            mediaRecorder = null
        }

        outputFile = null
        if (stopFailure != null) {
            recordedFile.delete()
            throw AiDictationNoSpeechException(
                message = textProvider.noSpeechRecorded,
                cause = stopFailure
            )
        }
        val audioBytes = try {
            recordedFile.readBytes()
        } finally {
            recordedFile.delete()
        }
        if (audioBytes.isEmpty()) {
            throw AiDictationNoSpeechException(
                message = textProvider.noSpeechRecorded,
                cause = null
            )
        }

        return RecordedAiChatAudio(
            fileName = dictationFileName,
            mediaType = dictationMediaType,
            audioBytes = audioBytes
        )
    }

    fun cancelRecording() {
        mediaRecorder?.reset()
        mediaRecorder?.release()
        mediaRecorder = null
        outputFile?.delete()
        outputFile = null
    }
}

fun makeAiChatAttachmentFromCameraBitmap(
    bitmap: Bitmap,
    textProvider: AiTextProvider
): AiChatAttachment {
    val bytes = compressBitmapForAiChatAttachment(
        bitmap = bitmap,
        textProvider = textProvider
    )
    return makeAiChatAttachment(
        fileName = cameraAttachmentFileName,
        mediaType = cameraAttachmentMediaType,
        base64Data = bytes.base64()
    )
}

fun makeAiChatImageAttachmentFromUri(
    context: Context,
    uri: Uri,
    textProvider: AiTextProvider
): AiChatAttachment {
    val mediaType = resolveMimeType(context = context, uri = uri)
    if (mediaType.startsWith(prefix = "image/").not()) {
        throw AiAttachmentImportUserException(
            message = textProvider.selectedItemNotImage,
            cause = null
        )
    }
    val displayName = queryDisplayName(context = context, uri = uri)
        ?: "photo.${fileExtensionFromMimeType(mediaType = mediaType) ?: "jpg"}"
    val bytes = compressImageUriForAiChatAttachment(
        context = context,
        uri = uri,
        textProvider = textProvider
    )

    return makeAiChatAttachment(
        fileName = jpegFileName(fileName = displayName),
        mediaType = cameraAttachmentMediaType,
        base64Data = bytes.base64()
    )
}

fun makeAiChatDocumentAttachmentFromUri(
    context: Context,
    uri: Uri,
    textProvider: AiTextProvider
): AiChatAttachment {
    val bytes = readAiChatDocumentAttachmentBytes(
        context = context,
        uri = uri,
        textProvider = textProvider
    )
    requireAiChatAttachmentSize(
        byteCount = bytes.size,
        textProvider = textProvider
    )

    val displayName = queryDisplayName(context = context, uri = uri)
        ?: throw AiAttachmentImportUserException(
            message = textProvider.selectedFileNameUnavailable,
            cause = null
        )
    val mediaType = resolveMimeType(context = context, uri = uri)
    val fileExtension = resolveFileExtension(
        fileName = displayName,
        mediaType = mediaType,
        textProvider = textProvider
    )
    requireSupportedAiChatAttachmentExtension(
        fileExtension = fileExtension,
        textProvider = textProvider
    )
    val canonicalMediaType = canonicalAiChatAttachmentMediaTypeForExtension(fileExtension = fileExtension)

    return makeAiChatAttachment(
        fileName = displayName,
        mediaType = canonicalMediaType,
        base64Data = bytes.base64()
    )
}

private fun readAiChatDocumentAttachmentBytes(
    context: Context,
    uri: Uri,
    textProvider: AiTextProvider
): ByteArray {
    return try {
        context.contentResolver.openInputStream(uri)?.use { inputStream ->
            inputStream.readBytes()
        } ?: throw AiAttachmentImportUserException(
            message = textProvider.selectedFileReadFailed,
            cause = null
        )
    } catch (error: SecurityException) {
        throw error
    } catch (error: FileNotFoundException) {
        throw AiAttachmentImportUserException(
            message = textProvider.selectedFileReadFailed,
            cause = error
        )
    } catch (error: IOException) {
        throw AiAttachmentImportUserException(
            message = textProvider.selectedFileReadFailed,
            cause = error
        )
    }
}

fun aiChatDocumentPickerMimeTypes(): Array<String> {
    return arrayOf("*/*")
}

private fun queryDisplayName(
    context: Context,
    uri: Uri
): String? {
    val cursor = context.contentResolver.query(
        uri,
        arrayOf(OpenableColumns.DISPLAY_NAME),
        null,
        null,
        null
    ) ?: return null

    cursor.use {
        if (it.moveToFirst().not()) {
            return null
        }

        val columnIndex = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (columnIndex == -1) {
            return null
        }

        return it.getString(columnIndex)?.trim()?.ifEmpty { null }
    }
}

private fun resolveMimeType(
    context: Context,
    uri: Uri
): String {
    return context.contentResolver.getType(uri)?.trim()?.ifEmpty { null }
        ?: "application/octet-stream"
}

private fun resolveFileExtension(
    fileName: String,
    mediaType: String,
    textProvider: AiTextProvider
): String {
    val fileNameExtension = fileName.substringAfterLast(delimiter = '.', missingDelimiterValue = "")
        .trim()
        .lowercase()
    if (fileNameExtension.isNotEmpty()) {
        return fileNameExtension
    }

    return fileExtensionFromMimeType(mediaType = mediaType)
        ?: throw AiAttachmentImportUserException(
            message = textProvider.selectedFileTypeUnsupported,
            cause = null
        )
}

private fun requireAiChatAttachmentSize(
    byteCount: Int,
    textProvider: AiTextProvider
) {
    if (byteCount > aiChatMaximumAttachmentBytes) {
        throw AiAttachmentImportUserException(
            message = textProvider.attachmentTooLarge,
            cause = null
        )
    }
}

private fun compressImageUriForAiChatAttachment(
    context: Context,
    uri: Uri,
    textProvider: AiTextProvider
): ByteArray {
    return try {
        val bitmap = decodeScaledBitmapFromUri(
            context = context,
            uri = uri,
            maxSidePixels = imageAttachmentMaxSidePixels
        )
        compressBitmapForAiChatAttachment(
            bitmap = bitmap,
            textProvider = textProvider
        )
    } catch (error: Exception) {
        if (error is AiAttachmentImportUserException) {
            throw error
        }
        throw AiAttachmentImportUserException(
            message = textProvider.selectedImageReadFailed,
            cause = error
        )
    }
}

private fun decodeScaledBitmapFromUri(
    context: Context,
    uri: Uri,
    maxSidePixels: Int
): Bitmap {
    val source = ImageDecoder.createSource(context.contentResolver, uri)
    return ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        val dimensions = scaledDimensions(
            width = info.size.width,
            height = info.size.height,
            maxSidePixels = maxSidePixels
        )
        decoder.setTargetSize(dimensions.width, dimensions.height)
    }
}

private data class ImageDimensions(
    val width: Int,
    val height: Int
)

private fun scaledDimensions(
    width: Int,
    height: Int,
    maxSidePixels: Int
): ImageDimensions {
    require(width > 0 && height > 0) {
        "Image dimensions must be positive."
    }
    val longestSide = maxOf(width, height)
    if (longestSide <= maxSidePixels) {
        return ImageDimensions(width = width, height = height)
    }

    val scale = maxSidePixels.toDouble() / longestSide.toDouble()
    return ImageDimensions(
        width = maxOf(1, kotlin.math.round(width.toDouble() * scale).toInt()),
        height = maxOf(1, kotlin.math.round(height.toDouble() * scale).toInt())
    )
}

private fun compressBitmapForAiChatAttachment(
    bitmap: Bitmap,
    textProvider: AiTextProvider
): ByteArray {
    val bytes = compressBitmapToJpeg(
        bitmap = scaledBitmap(
            bitmap = bitmap,
            maxSidePixels = imageAttachmentMaxSidePixels
        ),
        quality = imageAttachmentCompressionQuality,
        textProvider = textProvider
    )
    if (bytes.size <= aiChatMaximumAttachmentBytes) {
        return bytes
    }

    val fallbackBytes = compressBitmapToJpeg(
        bitmap = scaledBitmap(
            bitmap = bitmap,
            maxSidePixels = imageAttachmentFallbackMaxSidePixels
        ),
        quality = imageAttachmentFallbackCompressionQuality,
        textProvider = textProvider
    )
    requireAiChatAttachmentSize(
        byteCount = fallbackBytes.size,
        textProvider = textProvider
    )
    return fallbackBytes
}

private fun scaledBitmap(
    bitmap: Bitmap,
    maxSidePixels: Int
): Bitmap {
    val dimensions = scaledDimensions(
        width = bitmap.width,
        height = bitmap.height,
        maxSidePixels = maxSidePixels
    )
    if (dimensions.width == bitmap.width && dimensions.height == bitmap.height) {
        return bitmap
    }

    return Bitmap.createScaledBitmap(
        bitmap,
        dimensions.width,
        dimensions.height,
        true
    )
}

private fun compressBitmapToJpeg(
    bitmap: Bitmap,
    quality: Int,
    textProvider: AiTextProvider
): ByteArray {
    val outputStream = ByteArrayOutputStream()
    val didCompress = bitmap.compress(
        Bitmap.CompressFormat.JPEG,
        quality,
        outputStream
    )
    require(didCompress) {
        textProvider.capturedPhotoEncodeFailed
    }

    return outputStream.toByteArray()
}

private fun jpegFileName(fileName: String): String {
    val baseName = fileName.substringBeforeLast(delimiter = '.', missingDelimiterValue = fileName)
        .trim()
        .ifEmpty { "photo" }
    return "$baseName.jpg"
}

private fun requireSupportedAiChatAttachmentExtension(
    fileExtension: String,
    textProvider: AiTextProvider
) {
    val normalizedExtension = fileExtension.trim().lowercase()
    if (aiChatSupportedFileExtensions.contains(normalizedExtension).not()) {
        throw AiAttachmentImportUserException(
            message = textProvider.unsupportedFileType(extension = normalizedExtension),
            cause = null
        )
    }
}

private fun fileExtensionFromMimeType(
    mediaType: String
): String? {
    return MimeTypeMap.getSingleton().getExtensionFromMimeType(mediaType)?.trim()?.lowercase()
}

private fun ByteArray.base64(): String {
    return android.util.Base64.encodeToString(this, android.util.Base64.NO_WRAP)
}
