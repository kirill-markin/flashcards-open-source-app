import Foundation

enum SpreadsheetFieldSeparator: String, CaseIterable {
    case tab
    case comma
    case custom

    var title: String {
        switch self {
        case .tab: aiSettingsLocalized("settings.workspace.import.spreadsheet.separatorTab", "Tab")
        case .comma: aiSettingsLocalized("settings.workspace.import.spreadsheet.separatorComma", "Comma")
        case .custom: aiSettingsLocalized("settings.workspace.import.spreadsheet.separatorCustom", "Custom")
        }
    }

    func value(custom: String) -> String {
        switch self {
        case .tab: "\t"
        case .comma: ","
        case .custom: custom
        }
    }
}

enum SpreadsheetCardSeparator: String, CaseIterable {
    case newLine
    case semicolon
    case custom

    var title: String {
        switch self {
        case .newLine: aiSettingsLocalized("settings.workspace.import.spreadsheet.separatorNewLine", "New line")
        case .semicolon: aiSettingsLocalized("settings.workspace.import.spreadsheet.separatorSemicolon", "Semicolon")
        case .custom: aiSettingsLocalized("settings.workspace.import.spreadsheet.separatorCustom", "Custom")
        }
    }

    func value(custom: String) -> String {
        switch self {
        case .newLine: "\n"
        case .semicolon: ";"
        case .custom: custom
        }
    }
}

struct WorkspaceSpreadsheetCard: Identifiable, Sendable {
    let id: UUID
    var frontText: String
    var backText: String

    var isValid: Bool {
        !self.frontText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !self.backText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func makeEditorInput(tags: [String]) -> CardEditorInput {
        CardEditorInput(
            frontText: self.frontText.trimmingCharacters(in: .whitespacesAndNewlines),
            backText: self.backText.trimmingCharacters(in: .whitespacesAndNewlines),
            tags: tags
        )
    }
}

func parseWorkspaceSpreadsheetImport(source: String, fieldSeparator: String, cardSeparator: String) -> [WorkspaceSpreadsheetCard] {
    guard !fieldSeparator.isEmpty, !cardSeparator.isEmpty else { return [] }

    return source
        .replacingOccurrences(of: "\r\n", with: "\n")
        .replacingOccurrences(of: "\r", with: "\n")
        .components(separatedBy: cardSeparator)
        .compactMap { record in
            guard !record.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            let separator = record.range(of: fieldSeparator, options: .literal)
            let frontText = separator.map { record[..<$0.lowerBound] } ?? record[...]
            let backText = separator.map { record[$0.upperBound...] } ?? ""
            return WorkspaceSpreadsheetCard(
                id: UUID(),
                frontText: frontText.trimmingCharacters(in: .whitespacesAndNewlines),
                backText: backText.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        }
}

func makeWorkspaceSpreadsheetImportTag(now: Date) -> String {
    let importDate = formatIsoTimestamp(date: now).prefix(10)
    return "import:\(importDate)-\(UUID().uuidString.lowercased())"
}
