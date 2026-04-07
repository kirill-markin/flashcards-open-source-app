package com.flashcardsopensourceapp.data.local.ai

import android.util.Log
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart

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

    fun summarizeOutgoingContent(content: List<AiChatContentPart>): String {
        val textPartCount = content.count { part -> part is AiChatContentPart.Text }
        val reasoningSummaryPartCount = content.count { part -> part is AiChatContentPart.ReasoningSummary }
        val imagePartCount = content.count { part -> part is AiChatContentPart.Image }
        val filePartCount = content.count { part -> part is AiChatContentPart.File }
        val cardPartCount = content.count { part -> part is AiChatContentPart.Card }
        val toolCallPartCount = content.count { part -> part is AiChatContentPart.ToolCall }
        val accountUpgradePartCount = content.count { part -> part is AiChatContentPart.AccountUpgradePrompt }
        val unknownPartCount = content.count { part -> part is AiChatContentPart.Unknown }
        val textLength = content.sumOf { part ->
            when (part) {
                is AiChatContentPart.Text -> part.text.length
                is AiChatContentPart.ReasoningSummary -> 0
                is AiChatContentPart.Image -> 0
                is AiChatContentPart.File -> 0
                is AiChatContentPart.Card -> 0
                is AiChatContentPart.ToolCall -> 0
                is AiChatContentPart.AccountUpgradePrompt -> 0
                is AiChatContentPart.Unknown -> 0
            }
        }

        return "textParts=$textPartCount,reasoningSummaryParts=$reasoningSummaryPartCount,imageParts=$imagePartCount,fileParts=$filePartCount,cardParts=$cardPartCount,toolCallParts=$toolCallPartCount,accountUpgradeParts=$accountUpgradePartCount,unknownParts=$unknownPartCount,textLength=$textLength"
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
