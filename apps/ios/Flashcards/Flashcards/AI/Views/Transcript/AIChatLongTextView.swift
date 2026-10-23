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
                MathContentText(text: self.preview.text, textStyle: self.textStyle, isSelectable: self.isSelectable, isInteractive: true)
                Button(aiSettingsLocalized("ai.message.fullResponse.show", "Show full response")) {
                    self.isFullResponsePresented = true
                }
                .font(.subheadline.weight(.semibold))
            }
            .sheet(isPresented: self.$isFullResponsePresented) {
                AIChatFullResponseView(text: self.text)
            }
        } else {
            MathContentText(text: self.preview.text, textStyle: self.textStyle, isSelectable: self.isSelectable, isInteractive: true)
        }
    }
}

private struct AIChatDisplayChunk {
    let text: String
    let blocks: [ReviewMathBlock]
}

private func buildAIChatDisplayChunks(text: String) async -> [AIChatDisplayChunk]? {
    let task = Task.detached(priority: .userInitiated) { () -> [AIChatDisplayChunk]? in
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
        return chunks
    }
    return await withTaskCancellationHandler { await task.value } onCancel: { task.cancel() }
}

private struct AIChatFullResponseView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var chunks: [AIChatDisplayChunk]?

    let text: String

    init(text: String) {
        self.text = text
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                if let chunks = self.chunks {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(chunks.indices, id: \.self) { index in
                            MathContentText(text: chunks[index].text, isSelectable: true, parsedBlocks: chunks[index].blocks)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                        }
                    }
                    .padding()
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding()
                }
            }
            .task(id: self.text) {
                let text = self.text
                self.chunks = nil

                guard let chunks = await buildAIChatDisplayChunks(text: text) else {
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
