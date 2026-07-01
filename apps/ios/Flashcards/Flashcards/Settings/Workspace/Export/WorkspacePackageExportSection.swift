import SwiftUI

struct WorkspacePackageExportSection: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var preview: WorkspacePackageExportPreviewResponse?
    @State private var previewWorkspaceId: String = ""
    @State private var metadataDraft: WorkspacePackageExportMetadataDraft = WorkspacePackageExportMetadataDraft(
        label: "",
        author: "",
        comment: "",
        createdAt: "",
        sourceUrl: ""
    )
    @State private var removedTags: Set<String> = []
    @State private var isPreviewing: Bool = false
    @State private var isExporting: Bool = false
    @State private var errorMessage: String = ""
    @State private var successMessage: String = ""
    @State private var exportedFileURL: URL?
    @State private var isShareSheetPresented: Bool = false

    private var isBusy: Bool {
        self.isPreviewing || self.isExporting
    }

    private var currentWorkspaceId: String {
        self.store.workspace?.workspaceId ?? ""
    }

    private var currentPreview: WorkspacePackageExportPreviewResponse? {
        guard self.previewWorkspaceId == self.currentWorkspaceId else {
            return nil
        }

        return self.preview
    }

    private var cloudRequirementMessage: String? {
        switch self.store.cloudSettings?.cloudState {
        case .linked, .guest:
            return nil
        case .disconnected, .linkingReady, nil:
            return aiSettingsLocalized(
                "settings.workspace.export.cloudRequired",
                "Media package export requires a cloud account in this version."
            )
        }
    }

    var body: some View {
        Group {
            self.packageSection

            if self.errorMessage.isEmpty == false {
                Section {
                    Text(self.errorMessage)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier(UITestIdentifier.workspacePackageExportErrorMessage)
                }
            }

            if self.successMessage.isEmpty == false {
                Section {
                    Text(self.successMessage)
                        .foregroundStyle(.green)
                }
            }

            if let currentPreview {
                self.contentsSection(preview: currentPreview)
                self.metadataSection
                self.tagsSection(preview: currentPreview)
                self.confirmSection(preview: currentPreview)
            }
        }
        .onChange(of: self.currentWorkspaceId) { _, _ in
            self.resetPreview()
        }
        .sheet(
            isPresented: self.$isShareSheetPresented,
            onDismiss: {
                self.cleanupExportedFile()
            }
        ) {
            if let exportedFileURL = self.exportedFileURL {
                WorkspaceExportActivitySheet(activityItems: [exportedFileURL])
            } else {
                Text(aiSettingsLocalized("settings.workspace.export.fileUnavailable", "Export file is unavailable."))
            }
        }
    }

    private var packageSection: some View {
        Section(aiSettingsLocalized("settings.workspace.export.package.section", "flashcards.zip Package")) {
            Text(
                aiSettingsLocalized(
                    "settings.workspace.export.package.description",
                    "Export active cards, tags, and referenced media as flashcards.zip."
                )
            )
            .foregroundStyle(.secondary)

            Button {
                Task { @MainActor in
                    await self.previewPackageExport()
                }
            } label: {
                Label(self.previewButtonTitle, systemImage: "archivebox")
            }
            .disabled(self.isBusy || self.cloudRequirementMessage != nil)
            .accessibilityIdentifier(UITestIdentifier.workspacePackageExportPreviewButton)

            if let cloudRequirementMessage {
                Text(cloudRequirementMessage)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var metadataSection: some View {
        Section(aiSettingsLocalized("settings.workspace.export.package.metadata.section", "Metadata")) {
            TextField(
                aiSettingsLocalized("settings.workspace.export.package.metadata.label", "Label"),
                text: self.$metadataDraft.label
            )
            .disabled(self.isBusy)
            .accessibilityIdentifier(UITestIdentifier.workspacePackageExportMetadataLabelField)

            TextField(
                aiSettingsLocalized("settings.workspace.export.package.metadata.author", "Author"),
                text: self.$metadataDraft.author
            )
            .disabled(self.isBusy)
            .accessibilityIdentifier(UITestIdentifier.workspacePackageExportMetadataAuthorField)

            TextField(
                aiSettingsLocalized("settings.workspace.export.package.metadata.createdAt", "Created"),
                text: self.$metadataDraft.createdAt
            )
            .disabled(self.isBusy)
            .accessibilityIdentifier(UITestIdentifier.workspacePackageExportMetadataCreatedAtField)

            TextField(
                aiSettingsLocalized("settings.workspace.export.package.metadata.sourceUrl", "Source URL"),
                text: self.$metadataDraft.sourceUrl
            )
            .disabled(self.isBusy)
            .textInputAutocapitalization(.never)
            .keyboardType(.URL)
            .accessibilityIdentifier(UITestIdentifier.workspacePackageExportMetadataSourceUrlField)

            TextField(
                aiSettingsLocalized("settings.workspace.export.package.metadata.comment", "Comment"),
                text: self.$metadataDraft.comment,
                axis: .vertical
            )
            .lineLimit(2...4)
            .disabled(self.isBusy)
            .accessibilityIdentifier(UITestIdentifier.workspacePackageExportMetadataCommentField)
        }
    }

    private var previewButtonTitle: String {
        if self.isPreviewing {
            return aiSettingsLocalized("settings.workspace.export.package.previewing", "Previewing...")
        }

        return aiSettingsLocalized("settings.workspace.export.package.preview", "Preview Package Export")
    }

    private var exportButtonTitle: String {
        if self.isExporting {
            return aiSettingsLocalized("settings.workspace.export.package.exporting", "Exporting...")
        }

        return aiSettingsLocalized("settings.workspace.export.package.export", "Export flashcards.zip")
    }

    private func contentsSection(preview: WorkspacePackageExportPreviewResponse) -> some View {
        Section(aiSettingsLocalized("settings.workspace.export.package.contents.section", "Contents")) {
            LabeledContent(aiSettingsLocalized("settings.workspace.export.package.cards", "Cards")) {
                Text(preview.selectedCardCount, format: .number)
            }
            LabeledContent(aiSettingsLocalized("settings.workspace.export.package.referencedMedia", "Referenced Media")) {
                Text(preview.referencedMediaCount, format: .number)
            }
            LabeledContent(aiSettingsLocalized("settings.workspace.export.package.mediaSize", "Media Size")) {
                Text(formatWorkspacePackageExportByteCount(byteCount: preview.approximateReferencedMediaBytes))
            }
        }
    }

    private func tagsSection(preview: WorkspacePackageExportPreviewResponse) -> some View {
        Section(aiSettingsLocalized("settings.workspace.export.package.tags.section", "Tags")) {
            if preview.availableTagCounts.isEmpty {
                Text(aiSettingsLocalized("settings.workspace.export.package.tags.empty", "No tags."))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(makeWorkspacePackageExportTagOptions(preview: preview, removedTags: self.removedTags)) { tagOption in
                    Toggle(isOn: self.removeTagBinding(tag: tagOption.tag, isAlwaysRemoved: tagOption.isAlwaysRemoved)) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(self.removeTagTitle(tagOption: tagOption))
                            Text(self.tagCardsCountTitle(cardsCount: tagOption.cardsCount))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if tagOption.isAlwaysRemoved {
                                Text(self.generatedImportTagRemovalMessage)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .disabled(self.isBusy || tagOption.isAlwaysRemoved)
                    .accessibilityIdentifier(UITestIdentifier.workspacePackageExportTagTogglePrefix + tagOption.tag)
                }
            }
        }
    }

    private func confirmSection(preview: WorkspacePackageExportPreviewResponse) -> some View {
        Section {
            Button {
                Task { @MainActor in
                    await self.exportPackage(preview: preview)
                }
            } label: {
                HStack {
                    if self.isExporting {
                        ProgressView()
                    }
                    Text(self.exportButtonTitle)
                }
            }
            .disabled(self.isBusy)
            .accessibilityIdentifier(UITestIdentifier.workspacePackageExportConfirmButton)
        }
    }

    private func removeTagBinding(tag: String, isAlwaysRemoved: Bool) -> Binding<Bool> {
        Binding(
            get: {
                isAlwaysRemoved || self.removedTags.contains(tag)
            },
            set: { isRemoved in
                if isAlwaysRemoved {
                    self.removedTags.insert(tag)
                    return
                }
                if isRemoved {
                    self.removedTags.insert(tag)
                } else {
                    self.removedTags.remove(tag)
                }
            }
        )
    }

    private func tagCardsCountTitle(cardsCount: Int) -> String {
        if cardsCount == 1 {
            return aiSettingsLocalizedFormat("settings.workspace.export.package.tag.oneCard", "%d card", cardsCount)
        }

        return aiSettingsLocalizedFormat(
            "settings.workspace.export.package.tag.multipleCards",
            "%d cards",
            cardsCount
        )
    }

    private var generatedImportTagRemovalMessage: String {
        aiSettingsLocalized(
            "settings.workspace.export.package.generatedImportTagAlwaysRemoved",
            "Generated import tags are always removed from package exports."
        )
    }

    private func removeTagTitle(tagOption: WorkspacePackageExportTagOption) -> String {
        if tagOption.isAlwaysRemoved {
            return aiSettingsLocalizedFormat(
                "settings.workspace.export.package.alwaysRemoveTag",
                "Always remove %@",
                tagOption.tag
            )
        }

        return aiSettingsLocalizedFormat("settings.workspace.export.package.removeTag", "Remove %@", tagOption.tag)
    }

    @MainActor
    private func previewPackageExport() async {
        guard self.cleanupExportedFile() else {
            return
        }

        self.isPreviewing = true
        self.errorMessage = ""
        self.successMessage = ""
        self.resetPreview()

        do {
            let preview = try await self.store.previewCurrentWorkspacePackageExport(
                request: makeDefaultWorkspacePackageExportPreviewRequest()
            )
            self.preview = preview
            self.previewWorkspaceId = self.currentWorkspaceId
            self.metadataDraft = WorkspacePackageExportMetadataDraft(
                defaultPackageMetadata: preview.defaultPackageMetadata
            )
            self.removedTags = Set(preview.tagsSelectedForRemoval.map(\.tag))
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
    private func exportPackage(preview: WorkspacePackageExportPreviewResponse) async {
        guard self.previewWorkspaceId == self.currentWorkspaceId else {
            self.resetPreview()
            self.errorMessage = aiSettingsLocalized(
                "settings.workspace.export.package.previewRequired",
                "Preview this package export before downloading."
            )
            return
        }
        guard self.cleanupExportedFile() else {
            return
        }

        self.isExporting = true
        self.errorMessage = ""
        self.successMessage = ""

        do {
            let response = try await self.store.exportCurrentWorkspacePackage(
                request: makeWorkspacePackageExportRequest(
                    preview: preview,
                    metadataDraft: self.metadataDraft,
                    removedTags: self.removedTags
                )
            )
            let fileManager = FileManager.default
            self.exportedFileURL = try prepareWorkspacePackageExportDownload(
                response: response,
                fileManager: fileManager,
                temporaryDirectory: fileManager.temporaryDirectory
            )
            self.successMessage = aiSettingsLocalized(
                "settings.workspace.export.package.success",
                "flashcards.zip is ready to share."
            )
            self.isShareSheetPresented = true
        } catch {
            if isRequestCancellationError(error: error) {
                self.isExporting = false
                return
            }
            self.errorMessage = Flashcards.errorMessage(error: error)
        }

        self.isExporting = false
    }

    @MainActor
    private func resetPreview() {
        self.preview = nil
        self.previewWorkspaceId = ""
        self.removedTags = []
    }

    @MainActor
    @discardableResult
    private func cleanupExportedFile() -> Bool {
        guard let exportedFileURL = self.exportedFileURL else {
            return true
        }

        do {
            if FileManager.default.fileExists(atPath: exportedFileURL.path) {
                try FileManager.default.removeItem(at: exportedFileURL)
            }
        } catch {
            self.errorMessage = Flashcards.errorMessage(error: error)
            return false
        }

        self.exportedFileURL = nil
        return true
    }
}

#Preview {
    List {
        WorkspacePackageExportSection()
    }
    .environment(FlashcardsStore())
}
