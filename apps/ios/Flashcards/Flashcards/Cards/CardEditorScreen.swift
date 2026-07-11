import Foundation
import PhotosUI
import SwiftUI

private let reviewCardsStringsTableName: String = "ReviewCards"
private let cardEditorManagedImagePreviewWidth: CGFloat = 176
private let cardEditorManagedImagePreviewHeight: CGFloat = 128
private let cardEditorTextAreaCornerRadius: CGFloat = reviewContentSurfaceCornerRadius
private let cardEditorManagedImagePreviewCornerRadius: CGFloat = cardEditorTextAreaCornerRadius / 2
private let cardEditorManagedMediaReferenceExpression: NSRegularExpression = {
    do {
        return try NSRegularExpression(
            pattern: #"(!)?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)"#,
            options: [.anchorsMatchLines]
        )
    } catch {
        fatalError("Invalid card editor managed media reference regex")
    }
}()
private let cardEditorManagedMediaFenceExpression: NSRegularExpression = {
    do {
        return try NSRegularExpression(
            pattern: #"^\s{0,3}(`{3,}|~{3,})"#,
            options: [.anchorsMatchLines]
        )
    } catch {
        fatalError("Invalid card editor managed media fence regex")
    }
}()

struct CardFormState {
    var editorSessionId: UUID
    var frontText: String
    var backText: String
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
    let isEditing: Bool
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
                } header: {
                    Text(String(localized: "Metadata", table: reviewCardsStringsTableName))
                }

                if isEditing {
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
    @Binding var editorSessionId: UUID
    @Binding var mediaAssetIdsReadyForUpload: Set<String>
    @FocusState private var isTextEditorFocused: Bool
    @State private var isPhotoPickerPresented: Bool = false
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var textSelection: TextSelection?
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
                            self.text = cardEditorTextByRemovingManagedImageReference(
                                text: self.text,
                                mediaAssetId: reference.mediaAssetId,
                                occurrence: reference.occurrence
                            )
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
        self.activeImageImportId = importId
        self.isImportingImage = true
        self.imageImportTask = Task { @MainActor in
            await self.handleSelectedPhotoItem(
                item,
                editorSessionId: editorSessionId,
                importId: importId
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
        importId: UUID
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
                selection: self.textSelection
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

private struct CardEditorManagedImageReference: Identifiable, Hashable {
    let occurrence: Int
    let mediaAssetId: String
    let reviewReference: ReviewManagedMediaReference

    var id: String {
        "\(self.occurrence)-\(self.mediaAssetId)"
    }
}

private struct CardEditorMarkdownInsertion {
    let text: String
    let selection: TextSelection?
}

private struct CardEditorManagedImageMatch {
    let occurrence: Int
    let mediaAssetId: String
    let label: String?
    let range: Range<String.Index>
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

private func cardEditorManagedImageReferences(text: String) -> [CardEditorManagedImageReference] {
    cardEditorManagedImageMatches(text: text).map { match in
        CardEditorManagedImageReference(
            occurrence: match.occurrence,
            mediaAssetId: match.mediaAssetId,
            reviewReference: ReviewManagedMediaReference(
                mediaAssetId: match.mediaAssetId,
                label: match.label,
                isImageSyntax: true
            )
        )
    }
}

private func cardEditorTextByInsertingMarkdown(
    text: String,
    markdown: String,
    selection: TextSelection?
) -> CardEditorMarkdownInsertion {
    let replacementRange = cardEditorSingleSelectionRange(text: text, selection: selection)
    let insertionText = cardEditorMarkdownInsertionText(
        text: text,
        replacementRange: replacementRange,
        markdown: markdown
    )
    let insertionStartOffset = text.distance(from: text.startIndex, to: replacementRange.lowerBound)
    var nextText = text
    nextText.replaceSubrange(replacementRange, with: insertionText)
    let insertionEndIndex = nextText.index(nextText.startIndex, offsetBy: insertionStartOffset + insertionText.count)

    return CardEditorMarkdownInsertion(
        text: nextText,
        selection: TextSelection(insertionPoint: insertionEndIndex)
    )
}

private func cardEditorTextByRemovingManagedImageReference(
    text: String,
    mediaAssetId: String,
    occurrence: Int
) -> String {
    var nextText = text

    for match in cardEditorManagedImageMatches(text: text) {
        if match.occurrence == occurrence && match.mediaAssetId == mediaAssetId {
            nextText.removeSubrange(match.range)
            return nextText
        }
    }

    return text
}

private func cardEditorManagedImageMatches(text: String) -> [CardEditorManagedImageMatch] {
    var activeFenceMarker: String?
    var matches: [CardEditorManagedImageMatch] = []

    for lineRange in cardEditorLineRanges(text: text) {
        let line = String(text[lineRange])
        let fenceMarker = cardEditorManagedMediaFenceMarker(line: line)

        if let currentFenceMarker = activeFenceMarker {
            if fenceMarker == currentFenceMarker {
                activeFenceMarker = nil
            }
            continue
        }

        if let fenceMarker {
            activeFenceMarker = fenceMarker
            continue
        }

        matches.append(
            contentsOf: cardEditorManagedImageMatchesInLine(
                text: text,
                line: line,
                lineRange: lineRange,
                nextOccurrence: matches.count
            )
        )
    }

    return matches
}

private func cardEditorManagedImageMatchesInLine(
    text: String,
    line: String,
    lineRange: Range<String.Index>,
    nextOccurrence: Int
) -> [CardEditorManagedImageMatch] {
    let fullRange = NSRange(line.startIndex..<line.endIndex, in: line)
    let matches = cardEditorManagedMediaReferenceExpression.matches(in: line, options: [], range: fullRange)
    var imageMatches: [CardEditorManagedImageMatch] = []

    for match in matches {
        guard match.range(at: 1).location != NSNotFound,
              let urlRange = Range(match.range(at: 3), in: line),
              let matchRange = Range(match.range, in: line),
              let mediaAssetId = parseManagedMediaAssetId(reference: String(line[urlRange])) else {
            continue
        }

        imageMatches.append(
            CardEditorManagedImageMatch(
                occurrence: nextOccurrence + imageMatches.count,
                mediaAssetId: mediaAssetId,
                label: cardEditorManagedMediaLabel(text: line, match: match),
                range: cardEditorOriginalLineRange(
                    text: text,
                    line: line,
                    lineRange: lineRange,
                    matchRange: matchRange
                )
            )
        )
    }

    return imageMatches
}

private func cardEditorLineRanges(text: String) -> [Range<String.Index>] {
    var ranges: [Range<String.Index>] = []
    var lineStart = text.startIndex
    var currentIndex = text.startIndex

    while currentIndex < text.endIndex {
        if text[currentIndex].isNewline {
            ranges.append(lineStart..<currentIndex)
            currentIndex = text.index(after: currentIndex)
            lineStart = currentIndex
        } else {
            currentIndex = text.index(after: currentIndex)
        }
    }

    ranges.append(lineStart..<text.endIndex)
    return ranges
}

private func cardEditorManagedMediaFenceMarker(line: String) -> String? {
    let range = NSRange(line.startIndex..<line.endIndex, in: line)
    guard let match = cardEditorManagedMediaFenceExpression.firstMatch(in: line, options: [], range: range),
          let markerRange = Range(match.range(at: 1), in: line) else {
        return nil
    }

    return String(line[markerRange])
}

private func cardEditorOriginalLineRange(
    text: String,
    line: String,
    lineRange: Range<String.Index>,
    matchRange: Range<String.Index>
) -> Range<String.Index> {
    let lowerOffset = line.distance(from: line.startIndex, to: matchRange.lowerBound)
    let upperOffset = line.distance(from: line.startIndex, to: matchRange.upperBound)
    let lowerBound = text.index(lineRange.lowerBound, offsetBy: lowerOffset)
    let upperBound = text.index(lineRange.lowerBound, offsetBy: upperOffset)
    return lowerBound..<upperBound
}

private func cardEditorSingleSelectionRange(text: String, selection: TextSelection?) -> Range<String.Index> {
    guard let selection else {
        return text.endIndex..<text.endIndex
    }

    switch selection.indices {
    case .selection(let range):
        return range
    case .multiSelection:
        return text.endIndex..<text.endIndex
    @unknown default:
        return text.endIndex..<text.endIndex
    }
}

private func cardEditorMarkdownInsertionText(
    text: String,
    replacementRange: Range<String.Index>,
    markdown: String
) -> String {
    let leadingSeparator = cardEditorNeedsLeadingMarkdownSeparator(
        text: text,
        replacementRange: replacementRange
    ) ? "\n" : ""
    let trailingSeparator = cardEditorNeedsTrailingMarkdownSeparator(
        text: text,
        replacementRange: replacementRange
    ) ? "\n" : ""

    return "\(leadingSeparator)\(markdown)\(trailingSeparator)"
}

private func cardEditorNeedsLeadingMarkdownSeparator(
    text: String,
    replacementRange: Range<String.Index>
) -> Bool {
    guard replacementRange.lowerBound > text.startIndex else {
        return false
    }

    return text[text.index(before: replacementRange.lowerBound)].isNewline == false
}

private func cardEditorNeedsTrailingMarkdownSeparator(
    text: String,
    replacementRange: Range<String.Index>
) -> Bool {
    guard replacementRange.upperBound < text.endIndex else {
        return false
    }

    return text[replacementRange.upperBound].isNewline == false
}

private func cardEditorManagedMediaLabel(text: String, match: NSTextCheckingResult) -> String? {
    guard let labelRange = Range(match.range(at: 2), in: text) else {
        return nil
    }

    let label = String(text[labelRange]).trimmingCharacters(in: .whitespacesAndNewlines)
    return label.isEmpty ? nil : label
}

private func cardEditorImageImportFailureMessage(error: Error) -> String {
    String(
        format: String(localized: "Image couldn't be inserted. %@", table: reviewCardsStringsTableName),
        locale: Locale.current,
        Flashcards.errorMessage(error: error)
    )
}
