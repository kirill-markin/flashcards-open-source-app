package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import org.json.JSONObject

/*
 Keep user-facing AI tool call presentation aligned with:
 - apps/web/src/chat/chatMessageContent.tsx
 - apps/ios/Flashcards/Flashcards/AI/AIChatToolPresentation.swift
 */

fun formatAiToolLabel(name: String): String {
    return when (name) {
        "sql" -> "SQL"
        "code_execution", "code_interpreter" -> "Code execution"
        "web_search" -> "Web search"
        else -> name
    }
}

fun formatAiToolCallPreview(name: String, input: String?): String? {
    if (input == null || input.trim().isEmpty()) {
        return null
    }

    if (name != "sql") {
        return input
    }

    return try {
        val parsedInput = JSONObject(input)
        val sql = parsedInput.optString("sql").trim()
        if (sql.isEmpty()) {
            input
        } else {
            sql
        }
    } catch (_: Exception) {
        input
    }
}

fun formatAiToolCallSummaryText(name: String, input: String?): String {
    val toolLabel = formatAiToolLabel(name = name)
    val toolPreview = formatAiToolCallPreview(name = name, input = input)
    return if (toolPreview == null) {
        toolLabel
    } else {
        "$toolLabel: $toolPreview"
    }
}

fun formatAiToolCallStatus(status: AiChatToolCallStatus): String {
    return when (status) {
        AiChatToolCallStatus.STARTED -> "Running"
        AiChatToolCallStatus.COMPLETED -> "Done"
    }
}
