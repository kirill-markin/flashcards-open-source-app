import SwiftUI

struct WorkspacePackageExportSection: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    let exportCleanupErrorMessage: String
    let cleanupExportedFile: @MainActor () -> Bool
    let presentExportedFile: @MainActor (URL) -> Void

    @State private var preview: WorkspacePackageExportPreviewResponse?
    @State private var previewWorkspaceId: String = ""
    @State private var metadataDraft: WorkspacePackageExportMetadataDraft = WorkspacePackageExportMetadataDraft(
        label: "",
        author: "",
        comment: "",
        createdAt: "",
        sourceUrl: ""
    )
    @State private var selectedCardTags: Set<String> = []
    @State private var previewSelectedCardTags: Set<String> = []
    @State private var cardSelectionTagOptions: [WorkspacePackageExportTagCount] = []
    @State private var includedPackageTags: Set<String> = []
    @State private var isPreviewing: Bool = false
    @State private var isExporting: Bool = false
    @State private var errorMessage: String = ""
    @State private var successMessage: String = ""

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
        guard self.previewSelectedCardTags == self.selectedCardTags else {
            return nil
        }

        return self.preview
    }

    private var shouldShowInitialPreviewButton: Bool {
        self.currentPreview == nil && self.cardSelectionTagOptions.isEmpty
    }

    private var shouldShowStalePreviewSection: Bool {
        self.currentPreview == nil && self.cardSelectionTagOptions.isEmpty == false
    }

    private var displayedErrorMessage: String {
        [self.errorMessage, self.exportCleanupErrorMessage]
            .filter { $0.isEmpty == false }
            .joined(separator: "\n")
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

            if self.displayedErrorMessage.isEmpty == false {
                Section {
                    Text(self.displayedErrorMessage)
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
                self.cardSelectionSection
                self.contentsSection(preview: currentPreview)
                self.metadataSection
                self.tagsSection(preview: currentPreview)
                self.confirmSection(preview: currentPreview)
            } else if self.shouldShowStalePreviewSection {
                self.cardSelectionSection
                self.previewSection
            }
        }
        .onChange(of: self.currentWorkspaceId) { _, _ in
            self.resetWorkspaceExportState()
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

            if self.shouldShowInitialPreviewButton {
                self.previewButton
            }

            if let cloudRequirementMessage {
                Text(cloudRequirementMessage)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var previewSection: some View {
        Section {
            self.previewButton
        }
    }

    private var previewButton: some View {
        Button {
            Task { @MainActor in
                await self.previewPackageExport()
            }
        } label: {
            Label(self.previewButtonTitle, systemImage: "archivebox")
        }
        .disabled(self.isBusy || self.cloudRequirementMessage != nil)
        .accessibilityIdentifier(UITestIdentifier.workspacePackageExportPreviewButton)
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

    private var cardSelectionSection: some View {
        Section(aiSettingsLocalized("settings.workspace.export.package.cardSelection.section", "Cards")) {
            Button {
                self.selectAllCardsForExport()
            } label: {
                HStack {
                    Label(
                        aiSettingsLocalized("settings.workspace.export.package.cardSelection.allCards", "All cards"),
                        systemImage: "rectangle.stack"
                    )
                    .foregroundStyle(.primary)

                    Spacer()

                    if self.selectedCardTags.isEmpty {
                        Image(systemName: "checkmark")
                            .foregroundStyle(.tint)
                    }
                }
            }
            .buttonStyle(.plain)
            .disabled(self.isBusy)
            .accessibilityIdentifier(UITestIdentifier.workspacePackageExportCardSelectionAllCardsButton)

            if self.cardSelectionTagOptions.isEmpty {
                Text(aiSettingsLocalized("settings.workspace.export.package.cardSelection.tags.empty", "No tags."))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(self.cardSelectionTagOptions) { tagOption in
                    Toggle(isOn: self.selectedCardTagBinding(tag: tagOption.tag)) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(tagOption.tag)
                            Text(self.tagCardsCountTitle(cardsCount: tagOption.cardsCount))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .disabled(self.isBusy)
                    .accessibilityIdentifier(
                        UITestIdentifier.workspacePackageExportCardSelectionTagTogglePrefix + tagOption.tag
                    )
                }
            }
        }
    }

    private func tagsSection(preview: WorkspacePackageExportPreviewResponse) -> some View {
        Section(aiSettingsLocalized("settings.workspace.export.package.includedTags.section", "Included Tags")) {
            let tagOptions = makeWorkspacePackageExportTagOptions(preview: preview)
            if tagOptions.isEmpty {
                Text(aiSettingsLocalized("settings.workspace.export.package.includedTags.empty", "No package tags to include."))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(tagOptions) { tagOption in
                    Toggle(isOn: self.includePackageTagBinding(tag: tagOption.tag)) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(self.includeTagTitle(tag: tagOption.tag))
                            Text(self.tagCardsCountTitle(cardsCount: tagOption.cardsCount))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .disabled(self.isBusy)
                    .accessibilityIdentifier(UITestIdentifier.workspacePackageExportTagTogglePrefix + tagOption.tag)
                }
            }

            if workspacePackageExportHasGeneratedImportTags(preview: preview) {
                Text(self.generatedImportTagExclusionMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
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

    private func selectedCardTagBinding(tag: String) -> Binding<Bool> {
        Binding(
            get: {
                self.selectedCardTags.contains(tag)
            },
            set: { isSelected in
                if isSelected {
                    self.selectedCardTags.insert(tag)
                } else {
                    self.selectedCardTags.remove(tag)
                }
                self.resetPreview()
                self.errorMessage = ""
                self.successMessage = ""
            }
        )
    }

    private func includePackageTagBinding(tag: String) -> Binding<Bool> {
        Binding(
            get: {
                self.includedPackageTags.contains(tag)
            },
            set: { isIncluded in
                if isIncluded {
                    self.includedPackageTags.insert(tag)
                } else {
                    self.includedPackageTags.remove(tag)
                }
                self.errorMessage = ""
            }
        )
    }

    private func selectAllCardsForExport() {
        guard self.selectedCardTags.isEmpty == false else {
            return
        }

        self.selectedCardTags = []
        self.resetPreview()
        self.errorMessage = ""
        self.successMessage = ""
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

    private var generatedImportTagExclusionMessage: String {
        aiSettingsLocalized(
            "settings.workspace.export.package.generatedImportTagNotIncluded",
            "Generated import tags are not included in package exports."
        )
    }

    private func includeTagTitle(tag: String) -> String {
        aiSettingsLocalizedFormat("settings.workspace.export.package.includeTag", "Include %@", tag)
    }

    @MainActor
    private func previewPackageExport() async {
        guard self.cleanupExportedFile() else {
            return
        }

        self.isPreviewing = true
        self.errorMessage = ""
        self.successMessage = ""
        let selectedCardTags = self.selectedCardTags
        let additionalRemovedTags = Set(self.currentPreview.map { preview in
            makeWorkspacePackageExportAdditionalRemovedTags(
                preview: preview,
                includedTags: self.includedPackageTags
            )
        } ?? [])
        self.resetPreview()

        do {
            let preview = try await self.store.previewCurrentWorkspacePackageExport(
                request: makeWorkspacePackageExportPreviewRequest(
                    selectedCardTags: selectedCardTags,
                    additionalRemovedTags: additionalRemovedTags
                )
            )
            self.preview = preview
            self.previewWorkspaceId = self.currentWorkspaceId
            self.previewSelectedCardTags = selectedCardTags
            self.metadataDraft = WorkspacePackageExportMetadataDraft(
                defaultPackageMetadata: preview.defaultPackageMetadata
            )
            self.includedPackageTags = makeWorkspacePackageExportInitialIncludedTags(preview: preview)
            if selectedCardTags.isEmpty || self.cardSelectionTagOptions.isEmpty {
                self.cardSelectionTagOptions = preview.availableTagCounts
            }
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
        guard self.previewWorkspaceId == self.currentWorkspaceId,
              self.previewSelectedCardTags == self.selectedCardTags else {
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
                    selectedCardTags: self.selectedCardTags,
                    includedTags: self.includedPackageTags
                )
            )
            let fileManager = FileManager.default
            let exportedFileURL = try prepareWorkspacePackageExportDownload(
                response: response,
                fileManager: fileManager,
                temporaryDirectory: fileManager.temporaryDirectory
            )
            self.successMessage = aiSettingsLocalized(
                "settings.workspace.export.package.success",
                "flashcards.zip is ready to share."
            )
            self.isExporting = false
            self.presentExportedFile(exportedFileURL)
        } catch {
            if isRequestCancellationError(error: error) {
                self.isExporting = false
                return
            }
            self.errorMessage = Flashcards.errorMessage(error: error)
            self.isExporting = false
        }
    }

    private func resetPreview() {
        self.preview = nil
        self.previewWorkspaceId = ""
        self.previewSelectedCardTags = []
        self.includedPackageTags = []
    }

    private func resetWorkspaceExportState() {
        self.resetPreview()
        self.selectedCardTags = []
        self.cardSelectionTagOptions = []
    }
}

#Preview {
    List {
        WorkspacePackageExportSection(
            exportCleanupErrorMessage: "",
            cleanupExportedFile: { true },
            presentExportedFile: { _ in }
        )
    }
    .environment(FlashcardsStore())
}
