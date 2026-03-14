import SwiftUI

private enum CardEditorFocusedField: Hashable {
    case frontText
    case backText
}

struct CardFormState {
    var frontText: String
    var backText: String
    var tags: [String]
    var effortLevel: EffortLevel
}

struct CardEditorScreen: View {
    @EnvironmentObject private var store: FlashcardsStore
    @State private var isDeleteConfirmationPresented: Bool = false
    @FocusState private var focusedField: CardEditorFocusedField?

    let title: String
    let isEditing: Bool
    let errorMessage: String
    @Binding var formState: CardFormState
    let onCancel: () -> Void
    let onSave: () -> Void
    let onDelete: () -> Void

    private var availableTagSuggestions: [TagSuggestion] {
        tagSuggestions(cards: store.cards)
    }

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
                    CardEditorTextEditorRow(
                        title: "Front",
                        placeholder: "Front",
                        text: $formState.frontText,
                        focusedField: self.$focusedField,
                        field: .frontText
                    )

                    CardEditorTextEditorRow(
                        title: "Back",
                        placeholder: "Back",
                        text: $formState.backText,
                        focusedField: self.$focusedField,
                        field: .backText
                    )
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
            .contentShape(Rectangle())
            .simultaneousGesture(
                TapGesture().onEnded {
                    self.focusedField = nil
                }
            )
        }
        .navigationTitle(title)
        .alert("Delete this card?", isPresented: self.$isDeleteConfirmationPresented) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive, action: onDelete)
        } message: {
            Text("Deleting removes this card from the local list and from the next sync.")
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Cancel", action: onCancel)
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button("Save", action: onSave)
            }
        }
    }
}

private struct CardEditorTextEditorRow: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    @FocusState.Binding var focusedField: CardEditorFocusedField?
    let field: CardEditorFocusedField

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)

            ZStack(alignment: .topLeading) {
                if self.text.isEmpty {
                    Text(placeholder)
                        .foregroundStyle(.tertiary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 16)
                }

                TextEditor(text: self.$text)
                    .focused(self.$focusedField, equals: self.field)
                    .frame(minHeight: 180)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 8)
                    .background(Color(uiColor: .secondarySystemGroupedBackground))
            }
            .background(
                Color(uiColor: .secondarySystemGroupedBackground),
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color(uiColor: .separator).opacity(0.28), lineWidth: 1)
            )
        }
        .padding(.vertical, 4)
    }
}
