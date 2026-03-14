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
    @FocusState private var focusedField: FocusedField?

    let title: String
    let isEditing: Bool
    let errorMessage: String
    @Binding var formState: CardFormState
    let onCancel: () -> Void
    let onSave: () -> Void
    let onDelete: () -> Void

    private enum FocusedField: Hashable {
        case frontText
        case backText
    }

    private var availableTagSuggestions: [TagSuggestion] {
        tagSuggestions(cards: store.cards)
    }

    var body: some View {
        ZStack {
            Color(uiColor: .systemGroupedBackground)
                .ignoresSafeArea()

            ScrollView {
                ReadableContentLayout(
                    maxWidth: flashcardsReadableFormMaxWidth,
                    horizontalPadding: 16
                ) {
                    VStack(alignment: .leading, spacing: 20) {
                        if errorMessage.isEmpty == false {
                            self.errorCard
                        }

                        self.textSection
                        self.metadataSection

                        if isEditing {
                            self.actionsSection
                        }
                    }
                    .padding(.vertical, 20)
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

    private var errorCard: some View {
        Text(errorMessage)
            .foregroundStyle(.red)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(self.cardBackground, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Color.red.opacity(0.18), lineWidth: 1)
            )
    }

    private var textSection: some View {
        self.sectionContainer(title: "Text") {
            VStack(alignment: .leading, spacing: 16) {
                self.multilineInput(
                    title: "Front",
                    placeholder: "Front",
                    text: $formState.frontText,
                    field: .frontText
                )

                self.multilineInput(
                    title: "Back",
                    placeholder: "Back",
                    text: $formState.backText,
                    field: .backText
                )
            }
            .padding(16)
        }
    }

    private var metadataSection: some View {
        self.sectionContainer(title: "Metadata") {
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Text("Effort")

                    Spacer()

                    Picker("Effort", selection: $formState.effortLevel) {
                        ForEach(EffortLevel.allCases) { effortLevel in
                            Text(effortLevel.title).tag(effortLevel)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.menu)
                }
                .padding(16)

                Divider()

                NavigationLink {
                    TagPickerView(
                        selectedTags: formState.tags,
                        suggestions: availableTagSuggestions,
                        onSave: { nextTags in
                            formState.tags = nextTags
                        }
                    )
                } label: {
                    HStack(spacing: 12) {
                        TagsFieldRow(summary: formatTagSelectionSummary(tags: formState.tags))

                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .foregroundStyle(.primary)
            }
        }
    }

    private var actionsSection: some View {
        self.sectionContainer(title: "Actions") {
            Button("Delete card", role: .destructive) {
                self.isDeleteConfirmationPresented = true
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
        }
    }

    private func multilineInput(
        title: String,
        placeholder: String,
        text: Binding<String>,
        field: FocusedField
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)

            ZStack(alignment: .topLeading) {
                if text.wrappedValue.isEmpty {
                    Text(placeholder)
                        .foregroundStyle(.tertiary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 14)
                }

                TextEditor(text: text)
                    .focused(self.$focusedField, equals: field)
                    .frame(minHeight: 180)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 8)
                    .background(self.editorBackground)
            }
            .background(self.editorBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(self.editorBorderColor, lineWidth: 1)
            )
        }
    }

    private func sectionContainer<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)

            VStack(spacing: 0) {
                content()
            }
            .background(self.cardBackground, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(self.cardBorderColor, lineWidth: 1)
            )
        }
    }

    private var cardBackground: Color {
        Color(uiColor: .secondarySystemGroupedBackground)
    }

    private var cardBorderColor: Color {
        Color(uiColor: .separator).opacity(0.35)
    }

    private var editorBackground: Color {
        Color(uiColor: .systemBackground)
    }

    private var editorBorderColor: Color {
        Color(uiColor: .separator).opacity(0.28)
    }
}
