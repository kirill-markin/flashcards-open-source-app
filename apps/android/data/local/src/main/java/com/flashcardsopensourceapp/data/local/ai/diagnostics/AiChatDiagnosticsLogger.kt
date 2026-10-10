package com.flashcardsopensourceapp.data.local.ai.diagnostics

import android.util.Log
import com.flashcardsopensourceapp.data.local.model.ai.AiChatWireContentPart

private const val aiChatDiagnosticsLogTag: String = "FlashcardsAI"
private const val aiChatDiagnosticsMaxValueLength: Int = 1_200

object AiChatDiagnosticsLogger {
    fun info(event: String, fields: List<Pair<String, String?>>) {
        writeInfo(message = buildMessage(event = event, fields = fields))
    }

    fun warn(event: String, fields: List<Pair<String, String?>>) {
        writeWarn(message = buildMessage(event = event, fields = fields))
    }

    fun error(event: String, fields: List<Pair<String, String?>>) {
        writeError(message = buildMessage(event = event, fields = fields))
    }

    fun error(event: String, fields: List<Pair<String, String?>>, throwable: Throwable) {
        writeError(message = buildMessage(event = event, fields = fields), throwable = throwable)
    }

    fun summarizeOutgoingContent(content: List<AiChatWireContentPart>): String {
        val textPartCount = content.count { part -> part is AiChatWireContentPart.Text }
        val uploadPartCount = content.count { part -> part is AiChatWireContentPart.Upload }
        val cardPartCount = content.count { part -> part is AiChatWireContentPart.Card }
        val textLength = content.sumOf { part ->
            when (part) {
                is AiChatWireContentPart.Text -> part.text.length
                is AiChatWireContentPart.Upload -> 0
                is AiChatWireContentPart.Card -> 0
            }
        }

        return "textParts=$textPartCount,uploadParts=$uploadPartCount,cardParts=$cardPartCount,textLength=$textLength"
    }

    fun logUnknownContentReceived(
        originalType: String,
        sessionId: String,
        messageId: String,
        source: String
    ) {
        info(
            event = "ai_chat_unknown_content_received",
            fields = listOf(
                "originalType" to originalType,
                "sessionId" to sessionId,
                "messageId" to messageId,
                "source" to source
            )
        )
    }

    private fun buildMessage(event: String, fields: List<Pair<String, String?>>): String {
        val renderedFields = fields.map { (key, value) ->
            "$key=${sanitizeValue(value = value)}"
        }

        return if (renderedFields.isEmpty()) {
            "event=$event"
        } else {
            "event=$event ${renderedFields.joinToString(separator = " ")}"
        }
    }

    private fun sanitizeValue(value: String?): String {
        if (value == null) {
            return "null"
        }

        val normalized = value.replace(oldValue = "\n", newValue = "\\n")
        return if (normalized.length <= aiChatDiagnosticsMaxValueLength) {
            normalized
        } else {
            normalized.take(aiChatDiagnosticsMaxValueLength) + "..."
        }
    }

    private fun writeInfo(message: String) {
        val didLog = runCatching {
            Log.i(aiChatDiagnosticsLogTag, message)
        }.isSuccess
        if (didLog.not()) {
            println("$aiChatDiagnosticsLogTag I $message")
        }
    }

    private fun writeWarn(message: String) {
        val didLog = runCatching {
            Log.w(aiChatDiagnosticsLogTag, message)
        }.isSuccess
        if (didLog.not()) {
            println("$aiChatDiagnosticsLogTag W $message")
        }
    }

    private fun writeError(message: String) {
        val didLog = runCatching {
            Log.e(aiChatDiagnosticsLogTag, message)
        }.isSuccess
        if (didLog.not()) {
            println("$aiChatDiagnosticsLogTag E $message")
        }
    }

    private fun writeError(message: String, throwable: Throwable) {
        val didLog = runCatching {
            Log.e(aiChatDiagnosticsLogTag, message, throwable)
        }.isSuccess
        if (didLog.not()) {
            println("$aiChatDiagnosticsLogTag E $message")
            println(throwable.stackTraceToString())
        }
    }
}
