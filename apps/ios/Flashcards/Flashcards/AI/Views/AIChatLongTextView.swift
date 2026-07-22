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

    let previewEndIndex = text.index(
        text.startIndex,
        offsetBy: characterLimit,
        limitedBy: text.endIndex
    ) ?? text.endIndex

    guard previewEndIndex != text.endIndex else {
        return AIChatLongTextPreview(text: text, isTruncated: false)
    }

    return AIChatLongTextPreview(
        text: String(text[..<previewEndIndex]),
        isTruncated: true
    )
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

    @State private var isFullResponsePresented: Bool = false

    private let preview: AIChatLongTextPreview

    init(text: String) {
        self.text = text
        self.preview = buildAIChatLongTextPreview(
            text: text,
            characterLimit: aiChatLongTextPreviewCharacterLimit
        )
    }

    @ViewBuilder
    var body: some View {
        if self.preview.isTruncated {
            VStack(alignment: .leading, spacing: 8) {
                Text(verbatim: self.preview.text)
                Button(aiSettingsLocalized("ai.message.fullResponse.show", "Show full response")) {
                    self.isFullResponsePresented = true
                }
                .font(.subheadline.weight(.semibold))
            }
            .sheet(isPresented: self.$isFullResponsePresented) {
                AIChatFullResponseView(text: self.text)
            }
        } else {
            Text(verbatim: self.preview.text)
        }
    }
}

private struct AIChatFullResponseView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var chunks: [String]?

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
                            Text(verbatim: chunks[index])
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

                guard let chunks = await buildAIChatLongTextChunks(
                    text: text,
                    chunkCharacterLimit: aiChatLongTextChunkCharacterLimit
                ) else {
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
