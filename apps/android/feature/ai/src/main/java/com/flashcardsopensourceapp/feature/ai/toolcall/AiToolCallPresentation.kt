package com.flashcardsopensourceapp.feature.ai.toolcall

import com.flashcardsopensourceapp.data.local.model.ai.AiChatToolCallStatus
import com.flashcardsopensourceapp.feature.ai.strings.AiTextProvider

/*
 Keep user-facing AI tool call presentation aligned with:
 - apps/web/src/chat/history/chatMessageContent.tsx::formatToolLabel
 - apps/web/src/chat/history/chatMessageContent.tsx::extractToolCallPreview
 - apps/ios/Flashcards/Flashcards/AI/Views/Transcript/AIChatToolPresentation.swift::aiChatToolLabel
 - apps/ios/Flashcards/Flashcards/AI/Views/Transcript/AIChatToolPresentation.swift::aiChatToolPreview
 */

fun formatAiToolLabel(name: String, textProvider: AiTextProvider): String {
    return when (name) {
        // The server is still moving off "sql" toward split sql_query/sql_execute
        // names, but this branch stays forever: stored chat transcripts replay
        // historic tool calls under that name.
        "sql" -> textProvider.toolSql
        "sql_query" -> textProvider.toolSqlQuery
        "sql_execute" -> textProvider.toolSqlExecute
        "list_workspaces" -> textProvider.toolListWorkspaces
        "get_guide" -> textProvider.toolGetGuide
        "next_review_card" -> textProvider.toolNextReviewCard
        "reveal_answer" -> textProvider.toolRevealAnswer
        "submit_review" -> textProvider.toolSubmitReview
        "code_execution", "code_interpreter" -> textProvider.toolCodeExecution
        "add_generated_image_to_card" -> textProvider.toolGeneratedCardImage
        "web_search" -> textProvider.toolWebSearch
        else -> name
    }
}

fun formatAiToolCallPreview(name: String, input: String?): String? {
    if (name == "add_generated_image_to_card") {
        return null
    }

    if (input == null || input.trim().isEmpty()) {
        return null
    }

    if (!SQL_PREVIEW_TOOL_NAMES.contains(name)) {
        return input
    }

    val sql = extractSqlToolCallPreview(input = input)
    return if (sql == null) {
        input
    } else {
        sql
    }
}

fun formatAiToolCallSummaryText(name: String, input: String?, textProvider: AiTextProvider): String {
    val toolLabel = formatAiToolLabel(name = name, textProvider = textProvider)
    val toolPreview = formatAiToolCallPreview(name = name, input = input)
    return if (toolPreview == null) {
        toolLabel
    } else {
        "$toolLabel: $toolPreview"
    }
}

fun formatAiToolCallStatus(status: AiChatToolCallStatus, textProvider: AiTextProvider): String {
    return textProvider.toolStatus(status = status)
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

// Every SQL tool carries the statement in the same "sql" input field, so the
// retired "sql" name and the split read/write names share one preview path.
private val SQL_PREVIEW_TOOL_NAMES = setOf("sql", "sql_query", "sql_execute")

private val SQL_TOOL_INPUT_REGEX = Regex("\"sql\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"")
