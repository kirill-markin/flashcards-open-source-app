import Foundation

let widgetAppGroupIdentifierInfoPlistKey: String = "FLASHCARDS_APP_GROUP_IDENTIFIER"
let widgetSnapshotFileName: String = "widget-snapshot.json"

enum WidgetSnapshotFileError: LocalizedError {
    case missingAppGroupIdentifier(infoPlistKey: String)
    case missingAppGroupContainer(appGroupIdentifier: String)

    var errorDescription: String? {
        switch self {
        case .missingAppGroupIdentifier(let infoPlistKey):
            return "Info.plist key \(infoPlistKey) is missing or empty, so the widget App Group is unknown."
        case .missingAppGroupContainer(let appGroupIdentifier):
            return "App Group container \(appGroupIdentifier) is unavailable; check the App Group entitlement of this target."
        }
    }
}

func widgetSnapshotFileURL() throws -> URL {
    guard
        let appGroupIdentifier = Bundle.main.object(forInfoDictionaryKey: widgetAppGroupIdentifierInfoPlistKey) as? String,
        appGroupIdentifier.isEmpty == false
    else {
        throw WidgetSnapshotFileError.missingAppGroupIdentifier(infoPlistKey: widgetAppGroupIdentifierInfoPlistKey)
    }
    guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupIdentifier
    ) else {
        throw WidgetSnapshotFileError.missingAppGroupContainer(appGroupIdentifier: appGroupIdentifier)
    }
    return containerURL.appendingPathComponent(widgetSnapshotFileName, isDirectory: false)
}

/// Returns nil when no snapshot was written yet; a corrupt file throws.
func readWidgetSnapshot(fileURL: URL) throws -> WidgetSnapshot? {
    let data: Data
    do {
        data = try Data(contentsOf: fileURL)
    } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
        return nil
    }
    return try makeWidgetSnapshotDecoder().decode(WidgetSnapshot.self, from: data)
}

func writeWidgetSnapshot(snapshot: WidgetSnapshot, fileURL: URL) throws {
    let data = try makeWidgetSnapshotEncoder().encode(snapshot)
    try data.write(to: fileURL, options: [.atomic])
}

/// Deleting a snapshot that does not exist succeeds.
func deleteWidgetSnapshot(fileURL: URL) throws {
    do {
        try FileManager.default.removeItem(at: fileURL)
    } catch let error as CocoaError where error.code == .fileNoSuchFile {
        return
    }
}

private func makeWidgetSnapshotEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.sortedKeys]
    return encoder
}

private func makeWidgetSnapshotDecoder() -> JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return decoder
}
