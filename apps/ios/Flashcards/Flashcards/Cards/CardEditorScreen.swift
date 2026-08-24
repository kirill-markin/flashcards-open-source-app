import Foundation
import PhotosUI
import SwiftUI

private let reviewCardsStringsTableName: String = "ReviewCards"
private let cardEditorManagedImagePreviewWidth: CGFloat = 176
private let cardEditorManagedImagePreviewHeight: CGFloat = 128
private let cardEditorTextAreaCornerRadius: CGFloat = reviewContentSurfaceCornerRadius
private let cardEditorManagedImagePreviewCornerRadius: CGFloat = cardEditorTextAreaCornerRadius / 2

struct CardFormState {
    var editorSessionId: UUID
    let readOnlyMetadata: CardEditorReadOnlyMetadata?
    var frontText: String
    var backText: String
    var frontTextSelection: TextSelection?
    var backTextSelection: TextSelection?
    var observedFrontText: String?
    var observedBackText: String?
    var tags: [String]
    var mediaAssetIdsReadyForUpload: Set<String>
}

func cardEditorInlineErrorMessage(error: Error) -> String? {
    guard let localStoreError = error as? LocalStoreError else {
        return nil
    }

    switch localStoreError {
    case .validation:
        return Flashcards.errorMessage(error: error)
    case .notFound:
        return String(localized: "Card not found.", table: "ReviewCards")
    case .database, .uninitialized:
        return nil
    }
}

func cardFormStateByReconcilingMediaLifecycle(
    formState: CardFormState,
    refreshedCard: Card
) -> CardFormState {
    var nextFormState = formState

    if let observedFrontText = formState.observedFrontText {
        let frontReconciliation = cardEditorTextByReconcilingMediaLifecycle(
            text: formState.frontText,
            selection: formState.frontTextSelection,
            observedText: observedFrontText,
            refreshedText: refreshedCard.frontText
        )
        nextFormState.frontText = frontReconciliation.text
        nextFormState.frontTextSelection = frontReconciliation.selection
    }

    if let observedBackText = formState.observedBackText {
        let backReconciliation = cardEditorTextByReconcilingMediaLifecycle(
            text: formState.backText,
            selection: formState.backTextSelection,
            observedText: observedBackText,
            refreshedText: refreshedCard.backText
        )
        nextFormState.backText = backReconciliation.text
        nextFormState.backTextSelection = backReconciliation.selection
    }

    nextFormState.observedFrontText = refreshedCard.frontText
    nextFormState.observedBackText = refreshedCard.backText
    return nextFormState
}

private enum CardTextField: String {
    case front
    case back

    var title: String {
        switch self {
        case .front:
            return String(localized: "Front", table: reviewCardsStringsTableName)
        case .back:
            return String(localized: "Back", table: reviewCardsStringsTableName)
        }
    }

    var accessibilityIdentifier: String {
        switch self {
        case .front:
            return UITestIdentifier.cardEditorFrontTextEditor
        case .back:
            return UITestIdentifier.cardEditorBackTextEditor
        }
    }

    var reviewSurfaceStyle: ReviewCardSurfaceStyle {
        switch self {
        case .front:
            return .front
        case .back:
            return .back
        }
    }
}

struct CardEditorScreen: View {
    @State private var isDeleteConfirmationPresented: Bool = false

    let title: String
    let errorMessage: String
    let availableTagSuggestions: [TagSuggestion]
    @Binding var formState: CardFormState
    let onEditWithAI: (() -> Void)?
    let onCancel: () -> Void
    let onSave: () -> Void
    let onDelete: () -> Void

    var body: some View {
        ReadableContentLayout(
            maxWidth: flashcardsReadableFormMaxWidth,
            horizontalPadding: 0
        ) {
            Form {
                if errorMessage.isEmpty == false {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                    }
                }

                if let onEditWithAI {
                    Section {
                        Button(String(localized: "Edit with AI", table: reviewCardsStringsTableName), action: onEditWithAI)
                            .accessibilityIdentifier(UITestIdentifier.cardEditorEditWithAIButton)
                    }
                }

                Section {
                    NavigationLink {
                        CardTextEditorScreen(
                            field: .front,
                            text: $formState.frontText,
                            textSelection: $formState.frontTextSelection,
                            editorSessionId: $formState.editorSessionId,
                            mediaAssetIdsReadyForUpload: $formState.mediaAssetIdsReadyForUpload
                        )
                    } label: {
                        CardTextPreviewRow(
                            field: .front,
                            text: formState.frontText
                        )
                    }
                    .accessibilityIdentifier(UITestIdentifier.cardEditorFrontRow)

                    NavigationLink {
                        CardTextEditorScreen(
                            field: .back,
                            text: $formState.backText,
                            textSelection: $formState.backTextSelection,
                            editorSessionId: $formState.editorSessionId,
                            mediaAssetIdsReadyForUpload: $formState.mediaAssetIdsReadyForUpload
                        )
                    } label: {
                        CardTextPreviewRow(
                            field: .back,
                            text: formState.backText
                        )
                    }
                    .accessibilityIdentifier(UITestIdentifier.cardEditorBackRow)
                } header: {
                    Text(String(localized: "Text", table: reviewCardsStringsTableName))
                }

                Section {
                    NavigationLink {
                        TagPickerView(
                            selectedTags: formState.tags,
                            suggestions: availableTagSuggestions,
                            onSave: { nextTags in
                                formState.tags = nextTags
                            }
                        )
                    } label: {
                        TagsFieldRow(summary: localizedTagSelectionSummary(tags: formState.tags))
                    }

                    if let readOnlyMetadata = formState.readOnlyMetadata {
                        LabeledContent {
                            Text(localizedCardDueValue(dueAt: readOnlyMetadata.dueAt))
                                .foregroundStyle(.secondary)
                        } label: {
                            Label(String(localized: "Due", table: reviewCardsStringsTableName), systemImage: "clock")
                        }

                        LabeledContent {
                            Text(localizedCardCountValue(count: readOnlyMetadata.reps))
                                .foregroundStyle(.secondary)
                        } label: {
                            Label(String(localized: "Reps", table: reviewCardsStringsTableName), systemImage: "arrow.clockwise")
                        }

                        LabeledContent {
                            Text(localizedCardCountValue(count: readOnlyMetadata.lapses))
                                .foregroundStyle(.secondary)
                        } label: {
                            Label(String(localized: "Lapses", table: reviewCardsStringsTableName), systemImage: "exclamationmark.circle")
                        }
                    }
                } header: {
                    Text(String(localized: "Metadata", table: reviewCardsStringsTableName))
                }

                if formState.readOnlyMetadata != nil {
                    Section {
                        Button(String(localized: "Delete card", table: reviewCardsStringsTableName), role: .destructive) {
                            self.isDeleteConfirmationPresented = true
                        }
                    } header: {
                        Text(String(localized: "Actions", table: reviewCardsStringsTableName))
                    }
                }
            }
        }
        .navigationTitle(title)
        .alert(String(localized: "Delete this card?", table: reviewCardsStringsTableName), isPresented: self.$isDeleteConfirmationPresented) {
            Button(String(localized: "Cancel", table: reviewCardsStringsTableName), role: .cancel) {}
            Button(String(localized: "Delete", table: reviewCardsStringsTableName), role: .destructive, action: onDelete)
        } message: {
            Text(String(localized: "Deleting removes this card from the local list and from the next sync.", table: reviewCardsStringsTableName))
        }
        .accessibilityIdentifier(UITestIdentifier.cardEditorScreen)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(String(localized: "Cancel", table: reviewCardsStringsTableName), action: onCancel)
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button(String(localized: "Save", table: reviewCardsStringsTableName), action: onSave)
                    .accessibilityIdentifier(UITestIdentifier.cardEditorSaveButton)
            }
        }
    }
}

private struct CardTextPreviewRow: View {
    let field: CardTextField
    let text: String

    private var previewText: String {
        formatCardTextPreview(text: text)
    }

    private var previewStyle: AnyShapeStyle {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? AnyShapeStyle(.tertiary)
            : AnyShapeStyle(.primary)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(field.title)
                .font(.body)
                .foregroundStyle(.secondary)

            Text(previewText)
                .foregroundStyle(previewStyle)
                .multilineTextAlignment(.leading)
                .lineLimit(3)
        }
        .padding(.vertical, 4)
    }
}

private struct CardTextEditorScreen: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    let field: CardTextField
    @Binding var text: String
    @Binding var textSelection: TextSelection?
    @Binding var editorSessionId: UUID
    @Binding var mediaAssetIdsReadyForUpload: Set<String>
    @FocusState private var isTextEditorFocused: Bool
    @State private var isPhotoPickerPresented: Bool = false
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var isImportingImage: Bool = false
    @State private var imageImportTask: Task<Void, Never>?
    @State private var activeImageImportId: UUID?
    @State private var imageImportErrorMessage: String = ""
    @State private var isImageImportErrorPresented: Bool = false

    private var managedImageReferences: [CardEditorManagedImageReference] {
        cardEditorManagedImageReferences(text: self.text)
    }

    var body: some View {
        ReadableContentLayout(
            maxWidth: flashcardsReadableFormMaxWidth,
            horizontalPadding: 16
        ) {
            VStack(alignment: .leading, spacing: 12) {
                TextEditor(text: $text, selection: $textSelection)
                    .scrollContentBackground(.hidden)
                    .focused(self.$isTextEditorFocused)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .padding(12)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: cardEditorTextAreaCornerRadius, style: .continuous))
                    .accessibilityIdentifier(self.field.accessibilityIdentifier)

                if self.isImportingImage {
                    CardEditorImageProcessingView()
                }

                if self.managedImageReferences.isEmpty == false {
                    CardEditorManagedImageReferenceStrip(
                        references: self.managedImageReferences,
                        surfaceStyle: self.field.reviewSurfaceStyle,
                        onRemove: { reference in
                            let removal = cardEditorTextByRemovingManagedImageReference(
                                text: self.text,
                                selection: self.textSelection,
                                mediaAssetId: reference.mediaAssetId,
                                occurrence: reference.occurrence
                            )
                            self.text = removal.text
                            self.textSelection = removal.selection
                        }
                    )
                }
            }
        }
        .padding(.vertical, 16)
        .navigationTitle(self.field.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                self.addImageToolbarItem
            }
        }
        .photosPicker(
            isPresented: self.$isPhotoPickerPresented,
            selection: self.$selectedPhotoItem,
            matching: .images,
            preferredItemEncoding: .current,
            photoLibrary: .shared()
        )
        .alert(
            String(localized: "Image couldn't be inserted", table: reviewCardsStringsTableName),
            isPresented: self.$isImageImportErrorPresented
        ) {
            Button(String(localized: "Close", table: reviewCardsStringsTableName), role: .cancel) {}
        } message: {
            Text(self.imageImportErrorMessage)
        }
        .onChange(of: self.selectedPhotoItem) { _, newItem in
            guard let newItem else {
                return
            }

            self.startImageImport(item: newItem)
        }
        .onChange(of: self.editorSessionId) { _, _ in
            self.cancelImageImport()
            self.clearSelectedPhotoItem()
        }
        .onAppear {
            self.isTextEditorFocused = true
        }
        .onDisappear {
            self.cancelImageImport()
            self.clearSelectedPhotoItem()
        }
    }

    private var addImageToolbarItem: some View {
        Button {
            self.isPhotoPickerPresented = true
        } label: {
            if self.isImportingImage {
                ProgressView()
                    .controlSize(.small)
            } else {
                Image(systemName: "photo.badge.plus")
            }
        }
        .disabled(self.isImportingImage)
        .accessibilityLabel(
            self.isImportingImage
                ? String(localized: "Processing image...", table: reviewCardsStringsTableName)
                : String(localized: "Add image", table: reviewCardsStringsTableName)
        )
    }

    private func startImageImport(item: PhotosPickerItem) {
        self.cancelImageImport()
        let importId = UUID()
        let editorSessionId = self.editorSessionId
        let insertionAnchor = cardEditorMarkdownInsertionAnchor(
            text: self.text,
            selection: self.textSelection
        )
        self.activeImageImportId = importId
        self.isImportingImage = true
        self.imageImportTask = Task { @MainActor in
            await self.handleSelectedPhotoItem(
                item,
                editorSessionId: editorSessionId,
                importId: importId,
                insertionAnchor: insertionAnchor
            )
        }
    }

    private func cancelImageImport() {
        self.imageImportTask?.cancel()
        self.imageImportTask = nil
        self.activeImageImportId = nil
        self.isImportingImage = false
    }

    private func clearSelectedPhotoItem() {
        self.selectedPhotoItem = nil
    }

    private func handleSelectedPhotoItem(
        _ item: PhotosPickerItem,
        editorSessionId: UUID,
        importId: UUID,
        insertionAnchor: CardEditorMarkdownInsertionAnchor
    ) async {
        defer {
            self.completeImageImport(editorSessionId: editorSessionId, importId: importId)
        }

        do {
            let sourceImageData = try await item.loadTransferable(type: Data.self)
            try Task.checkCancellation()
            guard self.isCurrentImageImport(editorSessionId: editorSessionId, importId: importId) else {
                return
            }
            guard let sourceImageData else {
                self.presentImageImportError(
                    message: String(
                        localized: "Selected photo couldn't be read. Choose a different image.",
                        table: reviewCardsStringsTableName
                    )
                )
                return
            }

            try Task.checkCancellation()
            let preparedImage = try await prepareManagedImageDataInBackground(sourceImageData: sourceImageData)
            try Task.checkCancellation()
            guard self.isCurrentImageImport(editorSessionId: editorSessionId, importId: importId) else {
                return
            }
            let authoringResult = try self.store.authorCardEditorManagedImage(
                preparedImage: preparedImage,
                altText: String(localized: "Managed image", table: reviewCardsStringsTableName)
            )
            try Task.checkCancellation()
            guard self.isCurrentImageImport(editorSessionId: editorSessionId, importId: importId) else {
                return
            }
            self.mediaAssetIdsReadyForUpload.insert(authoringResult.mediaAsset.mediaAssetId)
            let insertion = cardEditorTextByInsertingMarkdown(
                text: self.text,
                markdown: authoringResult.markdown,
                insertionAnchor: insertionAnchor
            )
            self.text = insertion.text
            self.textSelection = insertion.selection
        } catch is CancellationError {
            return
        } catch {
            guard self.isCurrentImageImport(editorSessionId: editorSessionId, importId: importId) else {
                return
            }
            self.presentImageImportError(message: cardEditorImageImportFailureMessage(error: error))
        }
    }

    private func completeImageImport(editorSessionId: UUID, importId: UUID) {
        guard self.isCurrentImageImport(editorSessionId: editorSessionId, importId: importId) else {
            return
        }

        self.imageImportTask = nil
        self.activeImageImportId = nil
        self.isImportingImage = false
        self.clearSelectedPhotoItem()
    }

    private func isCurrentImageImport(editorSessionId: UUID, importId: UUID) -> Bool {
        self.editorSessionId == editorSessionId && self.activeImageImportId == importId
    }

    private func presentImageImportError(message: String) {
        self.imageImportErrorMessage = message
        self.isImageImportErrorPresented = true
    }
}

private struct CardEditorImageProcessingView: View {
    var body: some View {
        HStack(spacing: 10) {
            ProgressView()
                .controlSize(.small)
            Text(String(localized: "Processing image...", table: reviewCardsStringsTableName))
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct CardEditorManagedImageReferenceStrip: View {
    let references: [CardEditorManagedImageReference]
    let surfaceStyle: ReviewCardSurfaceStyle
    let onRemove: (CardEditorManagedImageReference) -> Void

    var body: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(references) { reference in
                    CardEditorManagedImagePreview(
                        reference: reference,
                        surfaceStyle: self.surfaceStyle,
                        onRemove: {
                            self.onRemove(reference)
                        }
                    )
                }
            }
            .padding(.horizontal, 2)
            .padding(.vertical, 2)
        }
        .scrollIndicators(.hidden)
    }
}

private struct CardEditorManagedImagePreview: View {
    let reference: CardEditorManagedImageReference
    let surfaceStyle: ReviewCardSurfaceStyle
    let onRemove: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            ReviewManagedMediaView(
                reference: self.reference.reviewReference,
                surfaceStyle: self.surfaceStyle
            )
            .frame(
                width: cardEditorManagedImagePreviewWidth,
                height: cardEditorManagedImagePreviewHeight,
                alignment: .center
            )
            .clipShape(RoundedRectangle(cornerRadius: cardEditorManagedImagePreviewCornerRadius, style: .continuous))

            Button(role: .destructive, action: self.onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.title3)
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(.secondary)
                    .background(.regularMaterial, in: Circle())
            }
            .buttonStyle(.plain)
            .padding(6)
            .accessibilityLabel(String(localized: "Remove image reference", table: reviewCardsStringsTableName))
        }
        .frame(
            width: cardEditorManagedImagePreviewWidth,
            height: cardEditorManagedImagePreviewHeight,
            alignment: .center
        )
    }
}

private func formatCardTextPreview(text: String) -> String {
    let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)

    if trimmedText.isEmpty {
        return String(localized: "Tap to edit", table: reviewCardsStringsTableName)
    }

    return trimmedText
        .split(whereSeparator: \.isNewline)
        .map(String.init)
        .joined(separator: " ")
}

private func cardEditorImageImportFailureMessage(error: Error) -> String {
    String(
        format: String(localized: "Image couldn't be inserted. %@", table: reviewCardsStringsTableName),
        locale: Locale.current,
        Flashcards.errorMessage(error: error)
    )
}
