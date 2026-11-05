import SwiftUI
import UIKit

private let aiChatLongTextPreviewCharacterLimit: Int = 4_000
private let aiChatLongTextChunkCharacterLimit: Int = 2_000

struct AIChatLongTextPreview {
    let text: String
    let isTruncated: Bool
}

func buildAIChatLongTextPreview(
    text: String,
    characterLimit: Int
) -> AIChatLongTextPreview {
    precondition(
        characterLimit > 0,
        "AI chat long text preview character limit must be greater than zero."
    )

    let preview = reviewMathTextPrefix(text: text, characterLimit: characterLimit)
    return AIChatLongTextPreview(text: preview, isTruncated: preview != text)
}

func segmentAIChatLongText(
    text: String,
    chunkCharacterLimit: Int,
    cancellationRequested: @Sendable () -> Bool
) -> [String]? {
    precondition(
        chunkCharacterLimit > 0,
        "AI chat long text chunk character limit must be greater than zero."
    )

    var fullTextChunks: [String] = []
    var chunkStartIndex: String.Index = text.startIndex

    while chunkStartIndex != text.endIndex {
        guard cancellationRequested() == false else {
            return nil
        }

        let chunkEndIndex = text.index(
            chunkStartIndex,
            offsetBy: chunkCharacterLimit,
            limitedBy: text.endIndex
        ) ?? text.endIndex
        fullTextChunks.append(String(text[chunkStartIndex..<chunkEndIndex]))
        chunkStartIndex = chunkEndIndex
    }

    return fullTextChunks
}

func buildAIChatLongTextChunks(
    text: String,
    chunkCharacterLimit: Int
) async -> [String]? {
    let segmentationTask = Task.detached(priority: .userInitiated) {
        segmentAIChatLongText(
            text: text,
            chunkCharacterLimit: chunkCharacterLimit,
            cancellationRequested: {
                Task.isCancelled
            }
        )
    }

    return await withTaskCancellationHandler {
        await segmentationTask.value
    } onCancel: {
        segmentationTask.cancel()
    }
}

struct AIChatLongTextView: View {
    let text: String
    let textStyle: UIFont.TextStyle
    let isSelectable: Bool

    @State private var isFullResponsePresented: Bool = false

    private let preview: AIChatLongTextPreview

    init(text: String, textStyle: UIFont.TextStyle = .body, isSelectable: Bool = false) {
        self.text = text
        self.textStyle = textStyle
        self.isSelectable = isSelectable
        self.preview = buildAIChatLongTextPreview(
            text: text,
            characterLimit: aiChatLongTextPreviewCharacterLimit
        )
    }

    @ViewBuilder
    var body: some View {
        if self.preview.isTruncated {
            VStack(alignment: .leading, spacing: 8) {
                AIChatContentText(text: self.preview.text, textStyle: self.textStyle, isSelectable: self.isSelectable)
                Button {
                    self.isFullResponsePresented = true
                } label: {
                    Text(aiSettingsLocalized("ai.message.fullResponse.show", "Show full response"))
                        #if targetEnvironment(macCatalyst)
                        .frame(minWidth: appMinimumTouchTarget, minHeight: appMinimumTouchTarget)
                        #endif
                        .contentShape(Rectangle())
                }
                .font(.subheadline.weight(.semibold))
            }
            .sheet(isPresented: self.$isFullResponsePresented) {
                AIChatFullResponseView(text: self.text)
            }
            .reviewKeyboardBlockingPresentation(isPresented: self.isFullResponsePresented)
        } else {
            AIChatContentText(text: self.preview.text, textStyle: self.textStyle, isSelectable: self.isSelectable)
        }
    }
}

/// Mirrors the web chat: classifier-approved Markdown renders like a card side, other text keeps native prose.
private struct AIChatContentText: View {
    let text: String
    let textStyle: UIFont.TextStyle
    let isSelectable: Bool

    var body: some View {
        if classifyReviewContentPresentation(text: self.text) == .markdown {
            AIChatMarkdownText(text: self.text, textStyle: self.textStyle, isSelectable: self.isSelectable)
        } else {
            MathContentText(text: self.text, textStyle: self.textStyle, isSelectable: self.isSelectable, isInteractive: true)
        }
    }
}

/// Renders text from an answer already classified as Markdown, so a chunk without a cue of its own stays Markdown.
private struct AIChatMarkdownText: View {
    let text: String
    let textStyle: UIFont.TextStyle
    let isSelectable: Bool

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let traits = UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(self.dynamicTypeSize))
        // An explicit font also keeps the caller's accessibility identifier on the text view.
        ReviewSelectableTextView(
            sourceText: self.text,
            content: makeAIChatMarkdownContent(text: self.text),
            surfaceStyle: .back,
            textFont: UIFont.preferredFont(forTextStyle: self.textStyle, compatibleWith: traits),
            isSelectable: self.isSelectable
        )
    }
}

/// `makeReviewRenderedContent` classifies the text again and returns plain prose when it finds no cue.
private func makeAIChatMarkdownContent(text: String) -> ReviewRenderedContent {
    let content = makeReviewRenderedContent(text: text)
    switch content {
    case .shortPlain, .paragraphPlain:
        return .markdown(makeReviewMarkdownContent(text: text))
    case .markdown, .managedMarkdown, .mathText:
        return content
    }
}

private struct AIChatDisplayChunk {
    let text: String
    let blocks: [ReviewMathBlock]
}

private enum AIChatFullResponseChunks {
    case markdown([String])
    case mathText([AIChatDisplayChunk])
}

private let aiChatMarkdownListItemExpression = makeReviewContentRegularExpression(
    pattern: #"^(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)"#
)

/// Splits only after a blank line outside code fences and formulas, before an unindented line that starts
/// no list item, so the chunks render as the same top-level blocks as the whole text.
private func segmentAIChatMarkdownText(
    text: String,
    chunkCharacterLimit: Int,
    cancellationRequested: () -> Bool
) -> [String]? {
    var formulaRanges: [Range<Int>] = []
    if containsReviewMathDelimiter(text: text), case .segmented(let mathBlocks) = extractReviewMathBlocks(text: text) {
        var offset = 0
        for mathBlock in mathBlocks {
            switch mathBlock {
            case .markdown(let source):
                offset += source.count
            case .formula(let formula):
                formulaRanges.append(offset..<(offset + formula.originalSource.count))
                offset += formula.originalSource.count
            }
        }
    }

    var blocks: [(text: String, count: Int)] = []
    var block = ""
    var blockCount = 0
    var offset = 0
    var formulaIndex = 0
    var openFence: (marker: Character, length: Int)?
    var isPreviousLineBlank = false

    func appendLine(_ line: String, content: Substring) {
        let lineCount = line.count
        while formulaIndex < formulaRanges.count, formulaRanges[formulaIndex].upperBound <= offset {
            formulaIndex += 1
        }
        let isInsideFormula = formulaIndex < formulaRanges.count && formulaRanges[formulaIndex].lowerBound < offset
        let isBlank = content.allSatisfy { $0 == " " || $0 == "\t" }
        if isPreviousLineBlank, openFence == nil, isInsideFormula == false, isBlank == false,
           content.first != " ", content.first != "\t",
           aiChatMarkdownListItemExpression.matches(String(content)) == false {
            blocks.append((block, blockCount))
            block = ""
            blockCount = 0
        }

        let indentedContent = content.drop { $0 == " " }
        if content.count - indentedContent.count <= 3,
           let marker = indentedContent.first, marker == "`" || marker == "~" {
            let run = indentedContent.prefix { $0 == marker }
            let isBare = indentedContent.dropFirst(run.count).allSatisfy { $0 == " " || $0 == "\t" }
            if let fence = openFence {
                if marker == fence.marker, run.count >= fence.length, isBare {
                    openFence = nil
                }
            } else if run.count >= 3 {
                openFence = (marker, run.count)
            }
        }

        block += line
        blockCount += lineCount
        offset += lineCount
        isPreviousLineBlank = isBlank
    }

    var line = ""
    for character in text {
        line.append(character)
        if character == "\n" || character == "\r" || character == "\r\n" {
            guard cancellationRequested() == false else {
                return nil
            }
            appendLine(line, content: line.dropLast())
            line = ""
        }
    }
    if line.isEmpty == false {
        appendLine(line, content: line[...])
    }
    if blockCount > 0 {
        blocks.append((block, blockCount))
    }

    var chunks: [String] = []
    var pendingText = ""
    var pendingCount = 0
    for block in blocks {
        if pendingCount > 0, pendingCount + block.count > chunkCharacterLimit {
            chunks.append(pendingText)
            pendingText = ""
            pendingCount = 0
        }
        pendingText += block.text
        pendingCount += block.count
    }
    if pendingCount > 0 {
        chunks.append(pendingText)
    }
    return chunks
}

private func buildAIChatFullResponseChunks(text: String) async -> AIChatFullResponseChunks? {
    let task = Task.detached(priority: .userInitiated) { () -> AIChatFullResponseChunks? in
        if classifyReviewContentPresentation(text: text) == .markdown {
            guard let chunks = segmentAIChatMarkdownText(
                text: text,
                chunkCharacterLimit: aiChatLongTextChunkCharacterLimit,
                cancellationRequested: { Task.isCancelled }
            ) else {
                return nil
            }
            return .markdown(chunks)
        }

        let blocks: [ReviewMathBlock]
        if containsReviewMathDelimiter(text: text), case .segmented(let mathBlocks) = extractReviewMathBlocks(text: text) {
            blocks = mathBlocks
        } else {
            blocks = [.markdown(text)]
        }
        var chunks: [AIChatDisplayChunk] = []
        var pendingText = ""
        var pendingBlocks: [ReviewMathBlock] = []
        func flush() {
            guard pendingText.isEmpty == false else { return }
            chunks.append(AIChatDisplayChunk(text: pendingText, blocks: pendingBlocks))
            pendingText = ""
            pendingBlocks = []
        }
        for block in blocks {
            guard Task.isCancelled == false else { return nil }
            switch block {
            case .markdown(let source):
                guard let segments = segmentAIChatLongText(text: source, chunkCharacterLimit: aiChatLongTextChunkCharacterLimit, cancellationRequested: { Task.isCancelled }) else { return nil }
                for segment in segments {
                    if pendingText.count + segment.count > aiChatLongTextChunkCharacterLimit { flush() }
                    pendingText += segment
                    pendingBlocks.append(.markdown(segment))
                }
            case .formula(let formula):
                if pendingText.count + formula.originalSource.count > aiChatLongTextChunkCharacterLimit { flush() }
                pendingText += formula.originalSource
                pendingBlocks.append(block)
            }
        }
        flush()
        return .mathText(chunks)
    }
    return await withTaskCancellationHandler { await task.value } onCancel: { task.cancel() }
}

private struct AIChatFullResponseView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var chunks: AIChatFullResponseChunks?

    let text: String

    init(text: String) {
        self.text = text
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                switch self.chunks {
                case .markdown(let chunks):
                    // Trailing blank lines do not render, so the stack restores the paragraph gap between chunks.
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(chunks.indices, id: \.self) { index in
                            AIChatMarkdownText(text: chunks[index], textStyle: .body, isSelectable: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding()
                case .mathText(let chunks):
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(chunks.indices, id: \.self) { index in
                            MathContentText(text: chunks[index].text, isSelectable: true, parsedBlocks: chunks[index].blocks)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                        }
                    }
                    .padding()
                case nil:
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding()
                }
            }
            .task(id: self.text) {
                let text = self.text
                self.chunks = nil

                guard let chunks = await buildAIChatFullResponseChunks(text: text) else {
                    return
                }
                guard Task.isCancelled == false else {
                    return
                }

                self.chunks = chunks
            }
            .navigationTitle(aiSettingsLocalized("ai.message.fullResponse.title", "Full response"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(aiSettingsLocalized("common.close", "Close")) {
                        self.dismiss()
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button(
                        aiSettingsLocalized("common.copy", "Copy"),
                        systemImage: "doc.on.doc"
                    ) {
                        UIPasteboard.general.string = self.text
                    }
                    .accessibilityLabel(aiSettingsLocalized("ai.tool.copy.response", "Copy response"))
                }
            }
        }
    }
}
