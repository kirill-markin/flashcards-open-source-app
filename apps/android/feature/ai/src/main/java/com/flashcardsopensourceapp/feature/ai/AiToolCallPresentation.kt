package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus

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

    val sql = extractSqlToolCallPreview(input = input)
    return if (sql == null) {
        input
    } else {
        sql
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

private fun extractSqlToolCallPreview(input: String): String? {
    val match = SQL_TOOL_INPUT_REGEX.find(input) ?: return null
    val sql = decodeJsonStringLiteral(value = match.groupValues[1]).trim()
    return if (sql.isEmpty()) {
        null
    } else {
        sql
    }
}

private fun decodeJsonStringLiteral(value: String): String {
    val output = StringBuilder()
    var index = 0

    while (index < value.length) {
        val character = value[index]
        if (character != '\\' || index == value.lastIndex) {
            output.append(character)
            index += 1
            continue
        }

        val escaped = value[index + 1]
        when (escaped) {
            '\\', '"', '/' -> output.append(escaped)
            'b' -> output.append('\b')
            'f' -> output.append('\u000C')
            'n' -> output.append('\n')
            'r' -> output.append('\r')
            't' -> output.append('\t')
            'u' -> {
                if (index + 5 >= value.length) {
                    output.append('\\')
                    output.append(escaped)
                    index += 2
                    continue
                }

                val unicode = value.substring(index + 2, index + 6)
                val decoded = unicode.toIntOrNull(radix = 16)
                if (decoded == null) {
                    output.append('\\')
                    output.append(escaped)
                } else {
                    output.append(decoded.toChar())
                    index += 4
                }
            }

            else -> {
                output.append('\\')
                output.append(escaped)
            }
        }

        index += 2
    }

    return output.toString()
}

private val SQL_TOOL_INPUT_REGEX = Regex("\"sql\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"")
