import Foundation

enum AIImportSourceInput: Hashable, Sendable {
    /// Lowercase extensions without the dot; the picker and validation accept exactly these.
    case files(extensions: [String])
    /// The pasted text is sent as one `text/plain` attachment with this name.
    case pastedText(fileName: String)
}

/// Keep a row per source brand even when file formats overlap. Every row hands off to the same AI import flow.
enum AIImportSource: String, Hashable, CaseIterable, Sendable {
    case quizlet
    case anki
    case noji
    case knowt
    case remnote
    case brainscape
    case studysmarter
    case cram
    case mochi
    case supermemo
    case ankiapp
    case other

    /// Brand names are never translated. Nil for `other`.
    var brandName: String? {
        switch self {
        case .quizlet: "Quizlet"
        case .anki: "Anki"
        case .noji: "Noji"
        case .knowt: "Knowt"
        case .remnote: "RemNote"
        case .brainscape: "Brainscape"
        case .studysmarter: "StudySmarter"
        case .cram: "Cram"
        case .mochi: "Mochi"
        case .supermemo: "SuperMemo"
        case .ankiapp: "AlgoApp (formerly AnkiApp)"
        case .other: nil
        }
    }

    var input: AIImportSourceInput {
        switch self {
        case .quizlet: .pastedText(fileName: "quizlet.txt")
        case .anki: .files(extensions: ["apkg", "colpkg"])
        case .noji: .files(extensions: ["csv", "ofc"])
        case .knowt: .files(extensions: ["pdf"])
        case .remnote: .files(extensions: ["apkg", "md", "txt"])
        case .brainscape, .studysmarter, .cram: .files(extensions: ["csv"])
        case .mochi: .files(extensions: ["mochi"])
        case .supermemo: .files(extensions: ["xml"])
        case .ankiapp: .files(extensions: ["zip", "xml"])
        case .other: .files(extensions: ["csv", "txt", "xlsx", "xls", "pdf", "json", "xml", "md", "docx", "zip"])
        }
    }

    /// The row subtitle, also named by the description and the invalid-file error.
    var formatsText: String {
        switch (self, self.input) {
        case (.other, _):
            return "CSV, TXT, XLSX, PDF"
        case (_, .pastedText):
            return aiSettingsLocalized("settings.workspace.import.aiImport.pasteSubtitle", "Paste exported text")
        case (_, .files(let extensions)):
            return extensions.map { ".\($0)" }.joined(separator: ", ")
        }
    }

    var localizedTitle: String {
        guard let brandName = self.brandName else {
            return aiSettingsLocalized("settings.workspace.import.aiImport.titleOther", "Import from another app")
        }
        return aiSettingsLocalizedFormat("settings.workspace.import.aiImport.title", "Import from %@", brandName)
    }

    var localizedDescription: String {
        if self == .quizlet {
            return aiSettingsLocalized(
                "settings.workspace.import.aiImport.descriptionQuizlet",
                "In Quizlet, open your set, choose Export, copy the text, and paste it here. AI chat imports the cards into this workspace."
            )
        }
        guard let brandName = self.brandName else {
            return aiSettingsLocalized(
                "settings.workspace.import.aiImport.descriptionOther",
                "Choose the files you exported from another flashcard app. AI chat imports the cards into this workspace."
            )
        }
        return aiSettingsLocalizedFormat(
            "settings.workspace.import.aiImport.description",
            "Choose the %1$@ files you exported from %2$@. AI chat imports the cards into this workspace.",
            self.formatsText,
            brandName
        )
    }

    /// The user message sent with the attachments; resolve it when the import request is created.
    var localizedRequestText: String {
        guard let brandName = self.brandName else {
            return aiSettingsLocalized(
                "settings.workspace.import.aiImport.requestOther",
                "Import cards from the attached files into this workspace."
            )
        }
        return aiSettingsLocalizedFormat(
            "settings.workspace.import.aiImport.request",
            "Import cards from %@ into this workspace.",
            brandName
        )
    }

    func localizedInvalidFileMessage(fileName: String) -> String {
        guard let brandName = self.brandName else {
            return aiSettingsLocalizedFormat(
                "settings.workspace.import.aiImport.invalidFileOther",
                "“%1$@” isn’t a supported file. Choose a non-empty %2$@ file.",
                fileName,
                self.formatsText
            )
        }
        return aiSettingsLocalizedFormat(
            "settings.workspace.import.aiImport.invalidFile",
            "“%1$@” isn’t a usable %2$@ export. Choose a non-empty %3$@ file.",
            fileName,
            brandName,
            self.formatsText
        )
    }

    var rowAccessibilityIdentifier: String {
        switch self {
        case .quizlet: UITestIdentifier.libraryQuizletImportRow
        case .anki: UITestIdentifier.libraryAnkiImportRow
        case .noji: UITestIdentifier.libraryNojiImportRow
        case .knowt: UITestIdentifier.libraryKnowtImportRow
        case .remnote: UITestIdentifier.libraryRemNoteImportRow
        case .brainscape: UITestIdentifier.libraryBrainscapeImportRow
        case .studysmarter: UITestIdentifier.libraryStudySmarterImportRow
        case .cram: UITestIdentifier.libraryCramImportRow
        case .mochi: UITestIdentifier.libraryMochiImportRow
        case .supermemo: UITestIdentifier.librarySuperMemoImportRow
        case .ankiapp: UITestIdentifier.libraryAnkiAppImportRow
        case .other: UITestIdentifier.libraryOtherAppImportRow
        }
    }
}
