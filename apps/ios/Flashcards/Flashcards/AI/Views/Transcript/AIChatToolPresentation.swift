import Foundation
import SwiftUI

struct AIChatToolSection: Hashable, Sendable, Identifiable {
    let id: String
    let title: String
    let text: String
    let copyButtonTitle: String
    let copyAccessibilityLabel: String
}

/**
 Mirrors:
 - `apps/web/src/chat/history/chatMessageContent.tsx::formatToolLabel`
 - `apps/web/src/chat/history/chatMessageContent.tsx::extractToolCallPreview`
 - `apps/android/feature/ai/src/main/java/com/flashcardsopensourceapp/feature/ai/toolcall/AiToolCallPresentation.kt::formatAiToolLabel`
 - `apps/android/feature/ai/src/main/java/com/flashcardsopensourceapp/feature/ai/toolcall/AiToolCallPresentation.kt::formatAiToolCallPreview`

 Keep user-facing tool labels aligned across web, iOS, and Android chat UIs.
 */
func aiChatToolLabel(name: String) -> String {
    switch name {
    case "sql":
        return "SQL"
    case "sql_query":
        return aiSettingsLocalized("ai.tool.label.sqlQuery", "SQL query")
    case "sql_execute":
        return aiSettingsLocalized("ai.tool.label.sqlExecute", "SQL write")
    case "list_workspaces":
        return aiSettingsLocalized("ai.tool.label.listWorkspaces", "List workspaces")
    case "get_guide":
        return aiSettingsLocalized("ai.tool.label.getGuide", "Get guide")
    case "next_review_card":
        return aiSettingsLocalized("ai.tool.label.nextReviewCard", "Next review card")
    case "reveal_answer":
        return aiSettingsLocalized("ai.tool.label.revealAnswer", "Reveal answer")
    case "submit_review":
        return aiSettingsLocalized("ai.tool.label.submitReview", "Submit review")
    case "code_execution", "code_interpreter":
        return aiSettingsLocalized("ai.tool.label.codeExecution", "Code execution")
    case "add_generated_image_to_card":
        return aiSettingsLocalized("ai.tool.label.generatedCardImage", "Generate card image")
    case "web_search":
        return aiSettingsLocalized("ai.tool.label.webSearch", "Web search")
    default:
        return name
    }
}

/// Tools whose input is a JSON object carrying the statement under `sql`.
private let aiChatSqlToolNames: Set<String> = [
    "sql",
    "sql_query",
    "sql_execute",
]

func aiChatToolPreview(name: String, input: String?) -> String? {
    if name == "add_generated_image_to_card" {
        return nil
    }

    guard let input, input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
        return nil
    }

    if aiChatSqlToolNames.contains(name) == false {
        return input
    }

    guard let data = input.data(using: .utf8),
          let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let sql = payload["sql"] as? String else {
        return input
    }

    let trimmedSql = sql.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmedSql.isEmpty ? input : trimmedSql
}

func aiChatToolSummaryText(name: String, input: String?) -> String {
    let toolLabel = aiChatToolLabel(name: name)
    guard let toolPreview = aiChatToolPreview(name: name, input: input) else {
        return toolLabel
    }

    return "\(toolLabel): \(toolPreview)"
}

func aiChatToolSections(input: String?, output: String?) -> [AIChatToolSection] {
    var sections: [AIChatToolSection] = []

    if let input, input.isEmpty == false {
        sections.append(
            AIChatToolSection(
                id: "request",
                title: aiSettingsLocalized("ai.tool.section.request", "Request"),
                text: input,
                copyButtonTitle: aiSettingsLocalized("common.copy", "Copy"),
                copyAccessibilityLabel: aiSettingsLocalized("ai.tool.copy.request", "Copy request")
            )
        )
    }

    if let output, output.isEmpty == false {
        sections.append(
            AIChatToolSection(
                id: "response",
                title: aiSettingsLocalized("ai.tool.section.response", "Response"),
                text: output,
                copyButtonTitle: aiSettingsLocalized("common.copy", "Copy"),
                copyAccessibilityLabel: aiSettingsLocalized("ai.tool.copy.response", "Copy response")
            )
        )
    }

    return sections
}

func aiChatToolStatusLabel(status: AIChatToolCallStatus) -> String {
    switch status {
    case .started:
        return aiSettingsLocalized("ai.tool.status.running", "Running")
    case .completed:
        return aiSettingsLocalized("ai.tool.status.done", "Done")
    }
}

func aiChatToolBorderColor(status: AIChatToolCallStatus) -> Color {
    switch status {
    case .started:
        return Color.secondary.opacity(0.4)
    case .completed:
        return Color(.separator)
    }
}

func aiChatToolBorderStrokeStyle(status: AIChatToolCallStatus) -> StrokeStyle {
    switch status {
    case .started:
        return StrokeStyle(lineWidth: 1, dash: [6, 4])
    case .completed:
        return StrokeStyle(lineWidth: 1)
    }
}
