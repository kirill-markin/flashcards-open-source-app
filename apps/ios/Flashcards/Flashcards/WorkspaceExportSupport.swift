import Foundation

func makeWorkspaceCardsCsv(cards: [Card]) -> String {
    let lines = [
        "frontText,backText,tags"
    ] + cards.map { card in
        [
            escapeWorkspaceExportCsvCell(value: card.frontText),
            escapeWorkspaceExportCsvCell(value: card.backText),
            escapeWorkspaceExportCsvCell(value: card.tags.joined(separator: ", "))
        ].joined(separator: ",")
    }

    return lines.joined(separator: "\r\n") + "\r\n"
}

func makeWorkspaceExportFilename(workspaceName: String, now: Date, calendar: Calendar) -> String {
    let year = calendar.component(.year, from: now)
    let month = calendar.component(.month, from: now)
    let day = calendar.component(.day, from: now)
    return "\(slugifyWorkspaceExportWorkspaceName(workspaceName: workspaceName))-cards-export-\(String(format: "%04d-%02d-%02d", year, month, day)).csv"
}

func prepareWorkspaceCardsCsvExport(
    database: LocalDatabase,
    workspace: Workspace,
    now: Date,
    calendar: Calendar,
    fileManager: FileManager,
    temporaryDirectory: URL
) throws -> URL {
    let cards = try database.loadActiveCards(workspaceId: workspace.workspaceId)
    let filename = makeWorkspaceExportFilename(
        workspaceName: workspace.name,
        now: now,
        calendar: calendar
    )
    let fileURL = temporaryDirectory.appendingPathComponent(filename, isDirectory: false)
    let csv = makeWorkspaceCardsCsv(cards: cards)
    guard let csvData = csv.data(using: .utf8) else {
        throw LocalStoreError.validation("Workspace export could not be encoded as UTF-8 CSV")
    }

    if fileManager.fileExists(atPath: fileURL.path) {
        try fileManager.removeItem(at: fileURL)
    }

    try csvData.write(to: fileURL, options: .atomic)
    return fileURL
}

private func escapeWorkspaceExportCsvCell(value: String) -> String {
    let escapedValue = value.replacingOccurrences(of: "\"", with: "\"\"")
    if escapedValue.contains(",") || escapedValue.contains("\"") || escapedValue.contains("\n") || escapedValue.contains("\r") {
        return "\"\(escapedValue)\""
    }

    return escapedValue
}

private func slugifyWorkspaceExportWorkspaceName(workspaceName: String) -> String {
    let slug = workspaceName
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
        .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
        .replacingOccurrences(of: "^-+|-+$", with: "", options: .regularExpression)

    if slug.isEmpty {
        return "workspace"
    }

    return slug
}
