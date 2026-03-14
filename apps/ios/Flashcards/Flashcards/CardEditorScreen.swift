import SwiftUI

struct CardFormState {
    var frontText: String
    var backText: String
    var tags: [String]
    var effortLevel: EffortLevel
}

struct CardEditorScreen: View {
    @EnvironmentObject private var store: FlashcardsStore
    @State private var isDeleteConfirmationPresented: Bool = false

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
                    TextField("Front", text: $formState.frontText, axis: .vertical)
                        .lineLimit(3...)
                    TextField("Back", text: $formState.backText, axis: .vertical)
                        .lineLimit(3...)
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
