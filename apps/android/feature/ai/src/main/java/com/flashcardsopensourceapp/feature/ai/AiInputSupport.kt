package com.flashcardsopensourceapp.feature.ai

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaRecorder
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.aiChatMaximumAttachmentBytes
import com.flashcardsopensourceapp.data.local.model.aiChatSupportedFileExtensions
import com.flashcardsopensourceapp.data.local.model.makeAiChatAttachment
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID

private const val cameraAttachmentFileName: String = "photo.jpg"
private const val cameraAttachmentMediaType: String = "image/jpeg"
private const val dictationFileName: String = "chat-dictation.m4a"
private const val dictationMediaType: String = "audio/mp4"
private const val dictationOutputExtension: String = "m4a"

data class RecordedAiChatAudio(
    val fileName: String,
    val mediaType: String,
    val audioBytes: ByteArray
)

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

        try {
            recorder.stop()
        } finally {
            recorder.release()
            mediaRecorder = null
        }

        outputFile = null
        val audioBytes = try {
            recordedFile.readBytes()
        } finally {
            recordedFile.delete()
        }
        require(audioBytes.isNotEmpty()) {
            textProvider.noSpeechRecorded
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
    val outputStream = ByteArrayOutputStream()
    val didCompress = bitmap.compress(
        Bitmap.CompressFormat.JPEG,
        90,
        outputStream
    )
    require(didCompress) {
        textProvider.capturedPhotoEncodeFailed
    }

    val bytes = outputStream.toByteArray()
    requireAiChatAttachmentSize(
        byteCount = bytes.size,
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
    val bytes = context.contentResolver.openInputStream(uri)?.use { inputStream ->
        inputStream.readBytes()
    } ?: throw IllegalArgumentException(textProvider.selectedImageReadFailed)
    requireAiChatAttachmentSize(
        byteCount = bytes.size,
        textProvider = textProvider
    )

    val displayName = queryDisplayName(context = context, uri = uri)
        ?: "photo.${fileExtensionFromMimeType(mediaType = resolveMimeType(context = context, uri = uri)) ?: "jpg"}"
    val mediaType = resolveMimeType(context = context, uri = uri)
    require(mediaType.startsWith(prefix = "image/")) {
        textProvider.selectedItemNotImage
    }

    return makeAiChatAttachment(
        fileName = displayName,
        mediaType = mediaType,
        base64Data = bytes.base64()
    )
}

fun makeAiChatDocumentAttachmentFromUri(
    context: Context,
    uri: Uri,
    textProvider: AiTextProvider
): AiChatAttachment {
    val bytes = context.contentResolver.openInputStream(uri)?.use { inputStream ->
        inputStream.readBytes()
    } ?: throw IllegalArgumentException(textProvider.selectedFileReadFailed)
    requireAiChatAttachmentSize(
        byteCount = bytes.size,
        textProvider = textProvider
    )

    val displayName = queryDisplayName(context = context, uri = uri)
        ?: throw IllegalArgumentException(textProvider.selectedFileNameUnavailable)
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

    return makeAiChatAttachment(
        fileName = displayName,
        mediaType = mediaType,
        base64Data = bytes.base64()
    )
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
        ?: throw IllegalArgumentException(textProvider.selectedFileTypeUnsupported)
}

private fun requireAiChatAttachmentSize(
    byteCount: Int,
    textProvider: AiTextProvider
) {
    require(byteCount <= aiChatMaximumAttachmentBytes) {
        textProvider.attachmentTooLarge
    }
}

private fun requireSupportedAiChatAttachmentExtension(
    fileExtension: String,
    textProvider: AiTextProvider
) {
    val normalizedExtension = fileExtension.trim().lowercase()
    require(aiChatSupportedFileExtensions.contains(normalizedExtension)) {
        textProvider.unsupportedFileType(extension = normalizedExtension)
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
