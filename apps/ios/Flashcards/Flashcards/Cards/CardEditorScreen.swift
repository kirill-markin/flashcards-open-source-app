import SwiftUI

private let reviewCardsStringsTableName: String = "ReviewCards"

struct CardFormState {
    var frontText: String
    var backText: String
    var tags: [String]
    var effortLevel: EffortLevel
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
                            text: $formState.frontText
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
                            text: $formState.backText
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
                    Picker(String(localized: "Effort", table: reviewCardsStringsTableName), selection: $formState.effortLevel) {
                        ForEach(EffortLevel.allCases) { effortLevel in
                            Text(localizedEffortTitle(effortLevel: effortLevel)).tag(effortLevel)
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
    let field: CardTextField
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
                .accessibilityIdentifier(self.field.accessibilityIdentifier)
        }
        .padding(.vertical, 16)
        .navigationTitle(self.field.title)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            self.isTextEditorFocused = true
        }
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
