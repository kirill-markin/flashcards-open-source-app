import SwiftUI

struct CardFormState {
    var frontText: String
    var backText: String
    var tags: [String]
    var effortLevel: EffortLevel
}

struct CardEditorScreen: View {
    @State private var isDeleteConfirmationPresented: Bool = false

    let title: String
    let isEditing: Bool
    let errorMessage: String
    let availableTagSuggestions: [TagSuggestion]
    @Binding var formState: CardFormState
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

                Section("Text") {
                    NavigationLink {
                        CardTextEditorScreen(
                            title: "Front",
                            text: $formState.frontText
                        )
                    } label: {
                        CardTextPreviewRow(
                            title: "Front",
                            text: formState.frontText
                        )
                    }
                    .accessibilityIdentifier(UITestIdentifier.cardEditorFrontRow)

                    NavigationLink {
                        CardTextEditorScreen(
                            title: "Back",
                            text: $formState.backText
                        )
                    } label: {
                        CardTextPreviewRow(
                            title: "Back",
                            text: formState.backText
                        )
                    }
                    .accessibilityIdentifier(UITestIdentifier.cardEditorBackRow)
                }

                Section("Metadata") {
                    Picker("Effort", selection: $formState.effortLevel) {
                        ForEach(EffortLevel.allCases) { effortLevel in
                            Text(effortLevel.title).tag(effortLevel)
                        }
                    }

                    NavigationLink {
                        TagPickerView(
                            selectedTags: formState.tags,
                            suggestions: availableTagSuggestions,
                            onSave: { nextTags in
                                formState.tags = nextTags
                            }
                        )
                    } label: {
                        TagsFieldRow(summary: formatTagSelectionSummary(tags: formState.tags))
                    }
                }

                if isEditing {
                    Section("Actions") {
                        Button("Delete card", role: .destructive) {
                            self.isDeleteConfirmationPresented = true
                        }
                    }
                }
            }
        }
        .navigationTitle(title)
        .alert("Delete this card?", isPresented: self.$isDeleteConfirmationPresented) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive, action: onDelete)
        } message: {
            Text("Deleting removes this card from the local list and from the next sync.")
        }
        .accessibilityIdentifier(UITestIdentifier.cardEditorScreen)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Cancel", action: onCancel)
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button("Save", action: onSave)
                    .accessibilityIdentifier(UITestIdentifier.cardEditorSaveButton)
            }
        }
    }
}

private struct CardTextPreviewRow: View {
    let title: String
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
            Text(title)
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
    let title: String
    @Binding var text: String
    @FocusState private var isTextEditorFocused: Bool

    var body: some View {
        ReadableContentLayout(
            maxWidth: flashcardsReadableFormMaxWidth,
            horizontalPadding: 16
        ) {
            TextEditor(text: $text)
                .scrollContentBackground(.hidden)
                .focused(self.$isTextEditorFocused)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(12)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                .accessibilityIdentifier(cardEditorTextEditorIdentifier(title: self.title))
        }
        .padding(.vertical, 16)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            self.isTextEditorFocused = true
        }
    }
}

private func cardEditorTextEditorIdentifier(title: String) -> String {
    if title == "Front" {
        return UITestIdentifier.cardEditorFrontTextEditor
    }

    return UITestIdentifier.cardEditorBackTextEditor
}

private func formatCardTextPreview(text: String) -> String {
    let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)

    if trimmedText.isEmpty {
        return "Tap to edit"
    }

    return trimmedText
        .split(whereSeparator: \.isNewline)
        .map(String.init)
        .joined(separator: " ")
}
