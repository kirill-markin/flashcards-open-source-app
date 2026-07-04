import SwiftUI

private struct WorkspaceImportMetadataRow: Hashable, Identifiable {
    let id: String
    let title: String
    let value: String
    let url: URL?
}

struct WorkspaceImportView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var selectedFile: WorkspacePackageImportSelectedFile?
    @State private var preview: WorkspacePackageImportPreviewResponse?
    @State private var addImportTag: Bool = true
    @State private var importTag: String = ""
    @State private var removedTags: Set<String> = []
    @State private var isFileImporterPresented: Bool = false
    @State private var isPreviewing: Bool = false
    @State private var isImporting: Bool = false
    @State private var errorMessage: String = ""
    @State private var successMessage: String = ""

    private var isBusy: Bool {
        self.isPreviewing || self.isImporting
    }

    private var cloudRequirementMessage: String? {
        switch self.store.cloudSettings?.cloudState {
        case .linked, .guest:
            return nil
        case .disconnected, .linkingReady, nil:
            return aiSettingsLocalized(
                "settings.workspace.import.cloudRequired",
                "Media ZIP import requires a cloud account in this version."
            )
        }
    }

    private var metadataRows: [WorkspaceImportMetadataRow] {
        guard let preview else {
            return []
        }

        let metadata = preview.packageMetadata
        var rows: [WorkspaceImportMetadataRow] = []
        if let label = metadata.label, label.isEmpty == false {
            rows.append(WorkspaceImportMetadataRow(
                id: "label",
                title: aiSettingsLocalized("settings.workspace.import.metadata.label", "Label"),
                value: label,
                url: nil
            ))
        }
        if let author = metadata.author, author.isEmpty == false {
            rows.append(WorkspaceImportMetadataRow(
                id: "author",
                title: aiSettingsLocalized("settings.workspace.import.metadata.author", "Author"),
                value: author,
                url: nil
            ))
        }
        if let createdAt = metadata.createdAt, createdAt.isEmpty == false {
            rows.append(WorkspaceImportMetadataRow(
                id: "createdAt",
                title: aiSettingsLocalized("settings.workspace.import.metadata.createdAt", "Created"),
                value: formatOptionalIsoTimestampForDisplay(value: createdAt),
                url: nil
            ))
        }
        if let sourceUrl = metadata.sourceUrl, sourceUrl.isEmpty == false {
            rows.append(WorkspaceImportMetadataRow(
                id: "sourceUrl",
                title: aiSettingsLocalized("settings.workspace.import.metadata.sourceUrl", "Source URL"),
                value: sourceUrl,
                url: URL(string: sourceUrl)
            ))
        }
        if let comment = metadata.comment, comment.isEmpty == false {
            rows.append(WorkspaceImportMetadataRow(
                id: "comment",
                title: aiSettingsLocalized("settings.workspace.import.metadata.comment", "Comment"),
                value: comment,
                url: nil
            ))
        }
        return rows
    }

    var body: some View {
        List {
            if self.errorMessage.isEmpty == false {
                Section {
                    Text(self.errorMessage)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier(UITestIdentifier.workspaceImportErrorMessage)
                }
            }

            if self.successMessage.isEmpty == false {
                Section {
                    Text(self.successMessage)
                        .foregroundStyle(.green)
                }
            }

            Section(aiSettingsLocalized("settings.workspace.import.section.package", "Package")) {
                Button {
                    self.isFileImporterPresented = true
                } label: {
                    Label(self.choosePackageTitle, systemImage: "doc.badge.plus")
                }
                .disabled(self.isBusy)
                .accessibilityIdentifier(UITestIdentifier.workspaceImportChooseFileButton)

                if let selectedFile {
                    LabeledContent(aiSettingsLocalized("settings.workspace.import.file", "File")) {
                        Text(selectedFile.fileName)
                            .multilineTextAlignment(.trailing)
                    }
                }

                if let cloudRequirementMessage {
                    Text(cloudRequirementMessage)
                        .foregroundStyle(.secondary)
                }
            }

            if let preview {
                self.sourceSection(preview: preview)
                self.packageMetadataSection
                self.countsSection(preview: preview)
                self.importOptionsSection(preview: preview)
                self.warningSection(preview: preview)
                self.confirmSection(preview: preview)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(aiSettingsLocalized("settings.workspace.import.title", "Import"))
        .accessibilityIdentifier(UITestIdentifier.workspaceImportScreen)
        .fileImporter(
            isPresented: self.$isFileImporterPresented,
            allowedContentTypes: workspacePackageImportAllowedContentTypes(),
            allowsMultipleSelection: false
        ) { result in
            self.handleFileImporterResult(result: result)
        }
    }

    private var choosePackageTitle: String {
        if self.isPreviewing {
            return aiSettingsLocalized("settings.workspace.import.previewing", "Previewing...")
        }
        return aiSettingsLocalized("settings.workspace.import.choosePackage", "Choose ZIP Package")
    }

    private var importButtonTitle: String {
        if self.isImporting {
            return aiSettingsLocalized("settings.workspace.import.importing", "Importing...")
        }
        return aiSettingsLocalized("settings.workspace.import.confirm", "Import Package")
    }

    private func sourceSection(preview: WorkspacePackageImportPreviewResponse) -> some View {
        Section(aiSettingsLocalized("settings.workspace.import.section.source", "Source")) {
            LabeledContent(aiSettingsLocalized("settings.workspace.import.sourceKind", "Type")) {
                Text(self.sourceKindTitle(sourceKind: preview.sourceKind))
            }
            if let selectedFile {
                LabeledContent(aiSettingsLocalized("settings.workspace.import.sourceTitle", "Title")) {
                    Text(selectedFile.fileName)
                        .multilineTextAlignment(.trailing)
                }
            }
        }
    }

    private var packageMetadataSection: some View {
        Section(aiSettingsLocalized("settings.workspace.import.section.metadata", "Metadata")) {
            if self.metadataRows.isEmpty {
                Text(aiSettingsLocalized("settings.workspace.import.metadata.empty", "No package metadata."))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(self.metadataRows) { row in
                    LabeledContent(row.title) {
                        if let url = row.url {
                            Link(row.value, destination: url)
                                .multilineTextAlignment(.trailing)
                        } else {
                            Text(row.value)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                }
            }
        }
    }

    private func countsSection(preview: WorkspacePackageImportPreviewResponse) -> some View {
        Section(aiSettingsLocalized("settings.workspace.import.section.contents", "Contents")) {
            LabeledContent(aiSettingsLocalized("settings.workspace.import.cards", "Cards")) {
                Text(preview.cardCount, format: .number)
            }
            LabeledContent(aiSettingsLocalized("settings.workspace.import.referencedMedia", "Referenced Media")) {
                Text(preview.referencedMediaCount, format: .number)
            }
            LabeledContent(aiSettingsLocalized("settings.workspace.import.packageMedia", "Package Media Files")) {
                Text(preview.packageMediaFileCount, format: .number)
            }
        }
    }

    private func importOptionsSection(preview: WorkspacePackageImportPreviewResponse) -> some View {
        Section(aiSettingsLocalized("settings.workspace.import.section.options", "Options")) {
            Toggle(
                aiSettingsLocalized("settings.workspace.import.addImportTag", "Add import tag"),
                isOn: self.$addImportTag
            )
            .accessibilityIdentifier(UITestIdentifier.workspaceImportAddImportTagToggle)

            if self.addImportTag {
                TextField(aiSettingsLocalized("settings.workspace.import.importTag", "Import Tag"), text: self.$importTag)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .disabled(self.isBusy)
                    .accessibilityIdentifier(UITestIdentifier.workspaceImportImportTagField)
            }

            if preview.tagCounts.isEmpty == false {
                ForEach(makeWorkspacePackageImportTagOptions(preview: preview, removedTags: self.removedTags)) { tagOption in
                    Toggle(isOn: self.keepTagBinding(tag: tagOption.tag)) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(self.keepTagTitle(tag: tagOption.tag))
                            Text(self.tagCardsCountTitle(cardsCount: tagOption.cardsCount))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .disabled(self.isBusy)
                    .accessibilityIdentifier(UITestIdentifier.workspaceImportTagTogglePrefix + tagOption.tag)
                }
            }
        }
    }

    private func warningSection(preview: WorkspacePackageImportPreviewResponse) -> some View {
        Section(aiSettingsLocalized("settings.workspace.import.section.warnings", "Warnings")) {
            if preview.warnings.isEmpty {
                Text(aiSettingsLocalized("settings.workspace.import.warnings.empty", "No warnings."))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(preview.warnings) { warning in
                    Text(workspacePackageImportWarningMessage(warning: warning))
                        .foregroundStyle(.orange)
                }
            }
        }
    }

    private func confirmSection(preview: WorkspacePackageImportPreviewResponse) -> some View {
        Section {
            Button {
                Task { @MainActor in
                    await self.confirmImport(preview: preview)
                }
            } label: {
                HStack {
                    if self.isImporting {
                        ProgressView()
                    }
                    Text(self.importButtonTitle)
                }
            }
            .disabled(self.isBusy || self.selectedFile == nil)
            .accessibilityIdentifier(UITestIdentifier.workspaceImportConfirmButton)
        }
    }

    private func keepTagBinding(tag: String) -> Binding<Bool> {
        Binding(
            get: {
                self.removedTags.contains(tag) == false
            },
            set: { isKept in
                if isKept {
                    self.removedTags.remove(tag)
                } else {
                    self.removedTags.insert(tag)
                }
            }
        )
    }

    private func sourceKindTitle(sourceKind: WorkspacePackageImportSourceKind) -> String {
        switch sourceKind {
        case .zip:
            return aiSettingsLocalized("settings.workspace.import.source.zip", "ZIP Package")
        }
    }

    private func tagCardsCountTitle(cardsCount: Int) -> String {
        if cardsCount == 1 {
            return aiSettingsLocalizedFormat("settings.workspace.import.tag.oneCard", "%d card", cardsCount)
        }

        return aiSettingsLocalizedFormat("settings.workspace.import.tag.multipleCards", "%d cards", cardsCount)
    }

    private func keepTagTitle(tag: String) -> String {
        aiSettingsLocalizedFormat("settings.workspace.import.keepTag", "Keep %@", tag)
    }

    private func handleFileImporterResult(result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let selectedUrl = urls.first else {
                self.errorMessage = aiSettingsLocalized(
                    "settings.workspace.import.noFileSelected",
                    "No package file was selected."
                )
                return
            }

            Task { @MainActor in
                await self.previewSelectedFile(url: selectedUrl)
            }
        case .failure(let error):
            if isRequestCancellationError(error: error) {
                return
            }
            self.errorMessage = Flashcards.errorMessage(error: error)
            self.successMessage = ""
        }
    }

    @MainActor
    private func previewSelectedFile(url: URL) async {
        self.isPreviewing = true
        self.errorMessage = ""
        self.successMessage = ""
        self.preview = nil
        self.selectedFile = nil
        self.removedTags = []
        self.importTag = ""

        do {
            let selectedFile = try readWorkspacePackageImportSelectedFile(url: url)
            let preview = try await self.store.previewCurrentWorkspacePackageImport(
                packageBytes: selectedFile.packageBytes
            )
            self.selectedFile = selectedFile
            self.preview = preview
            self.addImportTag = preview.defaultOptions.addImportTag
            self.importTag = preview.defaultOptions.suggestedImportTag
            self.removedTags = Set(preview.defaultOptions.removedTags)
        } catch {
            if isRequestCancellationError(error: error) {
                self.isPreviewing = false
                return
            }
            self.errorMessage = Flashcards.errorMessage(error: error)
        }

        self.isPreviewing = false
    }

    @MainActor
    private func confirmImport(preview: WorkspacePackageImportPreviewResponse) async {
        guard let selectedFile else {
            self.errorMessage = aiSettingsLocalized(
                "settings.workspace.import.previewRequired",
                "Preview a package before importing."
            )
            return
        }
        guard let cloudSettings = self.store.cloudSettings else {
            self.errorMessage = aiSettingsLocalized(
                "settings.workspace.import.cloudRequired",
                "Media ZIP import requires a cloud account in this version."
            )
            return
        }

        self.isImporting = true
        self.errorMessage = ""
        self.successMessage = ""

        do {
            let workspaceId = try requireWorkspaceId(workspace: self.store.workspace)
            let lastModifiedByReplicaId = try workspacePackageImportReplicaId(
                workspaceId: workspaceId,
                installationId: cloudSettings.installationId
            )
            let options = try makeWorkspacePackageImportConfirmOptions(
                preview: preview,
                addImportTag: self.addImportTag,
                importTag: self.importTag,
                removedTags: self.removedTags,
                lastModifiedByReplicaId: lastModifiedByReplicaId,
                now: Date()
            )
            let response = try await self.store.confirmCurrentWorkspacePackageImport(
                packageBytes: selectedFile.packageBytes,
                options: options
            )
            self.successMessage = workspacePackageImportSuccessMessage(summary: response.summary)
            self.preview = nil
            self.selectedFile = nil
            self.removedTags = []
            self.importTag = ""
        } catch {
            if isRequestCancellationError(error: error) {
                self.isImporting = false
                return
            }
            self.errorMessage = Flashcards.errorMessage(error: error)
        }

        self.isImporting = false
    }
}

#Preview {
    NavigationStack {
        WorkspaceImportView()
            .environment(FlashcardsStore())
    }
}
