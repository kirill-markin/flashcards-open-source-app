import SwiftUI

private let spreadsheetPreviewPageSize: Int = 25

struct WorkspaceSpreadsheetImportView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var sourceText: String = ""
    @State private var fieldSeparatorChoice: SpreadsheetFieldSeparator = .tab
    @State private var cardSeparatorChoice: SpreadsheetCardSeparator = .newLine
    @State private var customFieldSeparator: String = ""
    @State private var customCardSeparator: String = ""
    @State private var cards: [WorkspaceSpreadsheetCard] = []
    @State private var tags: [String] = []
    @State private var page: Int = 0
    @State private var isTagPickerPresented: Bool = false
    @State private var isImporting: Bool = false
    @State private var draftScope: SpreadsheetImportScope?
    @State private var requiresRestart: Bool = false
    @State private var errorMessage: String?
    @State private var successMessage: String?

    private var fieldSeparator: String {
        self.fieldSeparatorChoice.value(custom: self.customFieldSeparator)
    }

    private var cardSeparator: String {
        self.cardSeparatorChoice.value(custom: self.customCardSeparator)
    }

    private var hasMissingSeparator: Bool {
        self.fieldSeparator.isEmpty || self.cardSeparator.isEmpty
    }

    private var hasInvalidCards: Bool {
        self.cards.contains { !$0.isValid }
    }

    private var pageCount: Int {
        max(1, (self.cards.count + spreadsheetPreviewPageSize - 1) / spreadsheetPreviewPageSize)
    }

    private var visibleCards: ArraySlice<WorkspaceSpreadsheetCard> {
        let start = self.page * spreadsheetPreviewPageSize
        return self.cards[start..<min(start + spreadsheetPreviewPageSize, self.cards.count)]
    }

    private var canSubmitDraft: Bool {
        guard let draftScope else { return false }
        return !self.requiresRestart && self.store.spreadsheetImportScope == draftScope
    }

    private var isDraftVisible: Bool {
        guard let draftScope, let cloudSettings = self.store.cloudSettings else { return false }
        return draftScope.installationId == cloudSettings.installationId
            && draftScope.linkedUserId == cloudSettings.linkedUserId
    }

    private var visibleErrorMessage: String? {
        if self.draftScope != nil && !self.canSubmitDraft && !self.isImporting && self.successMessage == nil {
            return Flashcards.errorMessage(error: SpreadsheetImportScope.changedError())
        }
        return self.isDraftVisible ? self.errorMessage : nil
    }

    var body: some View {
        Form {
            if let errorMessage = self.visibleErrorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
            }
            if let successMessage {
                Text(successMessage)
                    .foregroundStyle(.green)
            }
            if self.isDraftVisible {
                self.sourceSection
                self.separatorSection
                self.tagsSection
                self.previewSection
                Section {
                    Button(action: self.importCards) {
                        HStack {
                            if self.isImporting {
                                ProgressView()
                            }
                            Text(aiSettingsLocalized("settings.workspace.import.confirm", "Import cards"))
                        }
                    }
                    .disabled(!self.canSubmitDraft || self.cards.isEmpty || self.hasInvalidCards || self.cards.count > localCardCreateBatchLimit)
                }
            }
        }
        .formStyle(.grouped)
        .disabled(self.isImporting)
        .nativeNavigationTitle(WorkspaceImportFormat.spreadsheet.localizedTitle)
        #if !targetEnvironment(macCatalyst)
        .toolbar {
            AICompanionToolbarItem()
        }
        #endif
        .sheet(isPresented: self.$isTagPickerPresented) {
            if self.canSubmitDraft {
                NavigationStack {
                    TagPickerView(selectedTags: self.$tags, suggestions: makeTagSuggestions(cards: self.store.cards))
                }
            }
        }
        .onChange(of: self.sourceText) {
            if !self.sourceText.isEmpty {
                self.successMessage = nil
            }
            self.updatePreview()
        }
        .onChange(of: self.fieldSeparator) { self.updatePreview() }
        .onChange(of: self.cardSeparator) { self.updatePreview() }
        .onChange(of: self.store.spreadsheetImportScope, initial: true) { _, scope in
            self.handleScopeChange(scope: scope)
        }
    }

    private var sourceSection: some View {
        let label = aiSettingsLocalized("settings.workspace.import.spreadsheet.textInputLabel", "Terms and definitions")
        return Section {
            TextEditor(text: self.$sourceText)
                .frame(minHeight: 100)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel(label)
                .accessibilityIdentifier(UITestIdentifier.workspaceSpreadsheetImportSource)
        } header: {
            Text(label)
        } footer: {
            Text(aiSettingsLocalized(
                "settings.workspace.import.spreadsheet.textDescription",
                "Copy terms and definitions from Quizlet, a spreadsheet, or a document. Review every card before importing."
            ))
        }
    }

    private var separatorSection: some View {
        Section {
            Picker(
                aiSettingsLocalized("settings.workspace.import.spreadsheet.fieldSeparatorLabel", "Between front and back"),
                selection: self.$fieldSeparatorChoice
            ) {
                ForEach(SpreadsheetFieldSeparator.allCases, id: \.self) { choice in
                    Text(choice.title).tag(choice)
                }
            }
            if self.fieldSeparatorChoice == .custom {
                TextField(
                    aiSettingsLocalized("settings.workspace.import.spreadsheet.customFieldSeparatorLabel", "Custom front and back separator"),
                    text: self.$customFieldSeparator
                )
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            }

            Picker(
                aiSettingsLocalized("settings.workspace.import.spreadsheet.cardSeparatorLabel", "Between cards"),
                selection: self.$cardSeparatorChoice
            ) {
                ForEach(SpreadsheetCardSeparator.allCases, id: \.self) { choice in
                    Text(choice.title).tag(choice)
                }
            }
            if self.cardSeparatorChoice == .custom {
                TextField(
                    aiSettingsLocalized("settings.workspace.import.spreadsheet.customCardSeparatorLabel", "Custom card separator"),
                    text: self.$customCardSeparator
                )
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            }

            if self.hasMissingSeparator && !self.sourceText.isEmpty {
                Text(aiSettingsLocalized("settings.workspace.import.spreadsheet.customSeparatorRequired", "Enter a custom separator to preview cards."))
                    .foregroundStyle(.red)
            }
        }
    }

    private var tagsSection: some View {
        Section {
            Button {
                self.isTagPickerPresented = true
            } label: {
                TagsFieldRow(summary: localizedTagSelectionSummary(tags: self.tags))
            }
            .disabled(!self.canSubmitDraft)
        } footer: {
            Text(aiSettingsLocalized(
                "settings.workspace.import.spreadsheet.textTagsDescription",
                "Choose tags for every imported card. Leave empty to add a unique import tag automatically."
            ))
        }
    }

    private var previewSection: some View {
        Section {
            if self.cards.isEmpty {
                Text(aiSettingsLocalized("settings.workspace.import.spreadsheet.textPreviewEmpty", "Paste text to preview cards."))
                    .foregroundStyle(.secondary)
            } else {
                LabeledContent(aiSettingsLocalized("settings.workspace.import.cards", "Cards")) {
                    Text(self.cards.count, format: .number)
                }
                if self.cards.count > localCardCreateBatchLimit {
                    Text(aiSettingsLocalizedFormat(
                        "settings.workspace.import.spreadsheet.textTooManyCards",
                        "Import up to %@ cards at a time.",
                        localCardCreateBatchLimit.formatted()
                    ))
                    .foregroundStyle(.red)
                }
                if self.hasInvalidCards {
                    Text(aiSettingsLocalized(
                        "settings.workspace.import.spreadsheet.textInvalidHelp",
                        "Add both a front and a back to every card, or delete incomplete cards."
                    ))
                    .foregroundStyle(.red)
                    Button(
                        aiSettingsLocalized("settings.workspace.import.spreadsheet.textDeleteInvalid", "Delete all invalid"),
                        role: .destructive
                    ) {
                        self.cards.removeAll { !$0.isValid }
                        self.clampPage()
                    }
                }
                ForEach(self.visibleCards) { card in
                    self.previewRow(card: card)
                }
                if self.pageCount > 1 {
                    self.previewPagination
                }
            }
        } header: {
            Text(aiSettingsLocalized("settings.workspace.import.spreadsheet.textPreviewTitle", "Preview"))
        }
    }

    private func previewRow(card: WorkspaceSpreadsheetCard) -> some View {
        let front = String(localized: "Front", table: "ReviewCards")
        let back = String(localized: "Back", table: "ReviewCards")
        return VStack(alignment: .leading, spacing: 8) {
            self.previewField(title: front, text: self.previewBinding(card: card, field: \.frontText))
            self.previewField(title: back, text: self.previewBinding(card: card, field: \.backText))
            Button(role: .destructive) {
                self.cards.removeAll { $0.id == card.id }
                self.clampPage()
            } label: {
                Label(String(localized: "Delete card", table: "ReviewCards"), systemImage: "trash")
            }
            .buttonStyle(.borderless)
        }
    }

    private func previewField(title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            TextField(title, text: text, axis: .vertical)
                .lineLimit(1...5)
        }
    }

    private func previewBinding(card: WorkspaceSpreadsheetCard, field: WritableKeyPath<WorkspaceSpreadsheetCard, String>) -> Binding<String> {
        Binding(
            get: { self.cards.first(where: { $0.id == card.id })?[keyPath: field] ?? card[keyPath: field] },
            set: { value in
                if let index = self.cards.firstIndex(where: { $0.id == card.id }) {
                    self.cards[index][keyPath: field] = value
                }
            }
        )
    }

    private var previewPagination: some View {
        HStack {
            Button(aiSettingsLocalized("settings.workspace.import.spreadsheet.previousPage", "Previous")) {
                self.page -= 1
            }
            .disabled(self.page == 0)

            Spacer()
            Text(aiSettingsLocalizedFormat(
                "settings.workspace.import.spreadsheet.pageStatus",
                "Page %1$@ of %2$@",
                (self.page + 1).formatted(),
                self.pageCount.formatted()
            ))
            .foregroundStyle(.secondary)
            Spacer()

            Button(aiSettingsLocalized("settings.workspace.import.spreadsheet.nextPage", "Next")) {
                self.page += 1
            }
            .disabled(self.page + 1 >= self.pageCount)
        }
        .buttonStyle(.borderless)
    }

    private func clampPage() {
        self.page = min(self.page, self.pageCount - 1)
    }

    private func updatePreview() {
        self.cards = parseWorkspaceSpreadsheetImport(
            source: self.sourceText,
            fieldSeparator: self.fieldSeparator,
            cardSeparator: self.cardSeparator
        )
        self.page = 0
    }

    private func clearDraft() {
        self.sourceText = ""
        self.cards = []
        self.tags = []
        self.page = 0
    }

    private func handleScopeChange(scope: SpreadsheetImportScope?) {
        guard let draftScope else {
            self.draftScope = scope
            return
        }
        guard scope != draftScope else { return }
        self.requiresRestart = true
        self.isTagPickerPresented = false

        if self.store.cloudSettings != nil && !self.isDraftVisible {
            self.clearDraft()
            self.fieldSeparatorChoice = .tab
            self.cardSeparatorChoice = .newLine
            self.customFieldSeparator = ""
            self.customCardSeparator = ""
            self.errorMessage = nil
        }
    }

    private func importCards() {
        guard self.canSubmitDraft, let scope = self.draftScope,
              !self.isImporting, !self.cards.isEmpty, !self.hasInvalidCards, self.cards.count <= localCardCreateBatchLimit else {
            return
        }
        let cards = self.cards
        let tags = self.tags.isEmpty ? [makeWorkspaceSpreadsheetImportTag(now: Date())] : self.tags
        self.isImporting = true
        self.errorMessage = nil
        self.successMessage = nil

        Task { @MainActor in
            defer { self.isImporting = false }
            do {
                let createdCount = try await self.store.createSpreadsheetImportCards(scope: scope, cards: cards, tags: tags)
                self.clearDraft()
                self.successMessage = aiSettingsLocalizedFormat(
                    "settings.workspace.import.success",
                    "Imported %d cards.",
                    createdCount
                )
            } catch {
                self.errorMessage = Flashcards.errorMessage(error: error)
            }
        }
    }
}
