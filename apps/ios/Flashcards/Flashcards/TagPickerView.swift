import SwiftUI

struct TagsFieldRow: View {
    let summary: String

    var body: some View {
        HStack {
            Text("Tags")
            Spacer()
            Text(summary)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}

private struct TagInputRow: View {
    @FocusState.Binding var isInputFocused: Bool
    @Binding var searchText: String
    let onSubmit: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "tag")
                .foregroundStyle(.secondary)

            TextField("Add or filter tags", text: $searchText)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .focused($isInputFocused)
                .onSubmit(onSubmit)

            if searchText.isEmpty == false {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct TagPickerRow: View {
    enum Detail: Equatable {
        case none
        case loading
        case count(Int)
        case label(String)
    }

    let title: String
    let isSelected: Bool
    let detail: Detail

    var body: some View {
        HStack {
            Text(title)
            Spacer()

            switch detail {
            case .none:
                EmptyView()
            case .loading:
                ProgressView()
                    .controlSize(.small)
            case .count(let cardsCount):
                Text("\(cardsCount)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            case .label(let text):
                Text(text)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if isSelected {
                Image(systemName: "checkmark")
                    .foregroundStyle(.tint)
            }
        }
        .contentShape(Rectangle())
    }
}

struct TagPickerView: View {
    @Environment(\.dismiss) private var dismiss

    let suggestions: [TagSuggestion]
    let onSave: ([String]) -> Void

    @State private var draftTags: [String]
    @State private var searchText: String
    @FocusState private var isInputFocused: Bool

    init(selectedTags: [String], suggestions: [TagSuggestion], onSave: @escaping ([String]) -> Void) {
        let normalizedSuggestions = normalizeTagSuggestions(suggestions: suggestions)
        self.suggestions = normalizedSuggestions
        self.onSave = onSave
        self._draftTags = State(
            initialValue: normalizeTags(
                values: selectedTags,
                referenceTags: normalizedSuggestions.map(\.tag)
            )
        )
        self._searchText = State(initialValue: "")
    }

    private var filteredSuggestions: [TagSuggestion] {
        filterTagSuggestions(
            suggestions: suggestions,
            selectedTags: draftTags,
            searchText: searchText
        )
    }

    private var selectedSuggestions: [TagSuggestion] {
        selectedTagSuggestions(selectedTags: draftTags, suggestions: suggestions)
    }

    private var nextCreatableTag: String? {
        creatableTagValue(
            searchText: searchText,
            selectedTags: draftTags,
            suggestions: suggestions
        )
    }

    private func handleSubmit() {
        guard let nextCreatableTag else {
            isInputFocused = false
            return
        }

        draftTags = toggleTagSelection(
            selectedTags: draftTags,
            tag: nextCreatableTag,
            suggestions: suggestions
        )
        searchText = ""
    }

    private func rowDetail(suggestion: TagSuggestion) -> TagPickerRow.Detail {
        switch suggestion.countState {
        case .loading:
            return .loading
        case .ready(let cardsCount):
            return .count(cardsCount)
        }
    }

    var body: some View {
        List {
            Section {
                TagInputRow(
                    isInputFocused: $isInputFocused,
                    searchText: $searchText,
                    onSubmit: handleSubmit
                )
            }

            if draftTags.isEmpty == false {
                Section("Selected") {
                    ForEach(selectedSuggestions, id: \.tag) { suggestion in
                        Button {
                            draftTags = toggleTagSelection(
                                selectedTags: draftTags,
                                tag: suggestion.tag,
                                suggestions: suggestions
                            )
                        } label: {
                            TagPickerRow(
                                title: suggestion.tag,
                                isSelected: true,
                                detail: rowDetail(suggestion: suggestion)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            Section("Suggestions") {
                if let nextCreatableTag {
                    Button {
                        draftTags = toggleTagSelection(
                            selectedTags: draftTags,
                            tag: nextCreatableTag,
                            suggestions: suggestions
                        )
                        searchText = ""
                    } label: {
                        TagPickerRow(
                            title: "Create \"\(nextCreatableTag)\"",
                            isSelected: false,
                            detail: .label("New")
                        )
                    }
                    .buttonStyle(.plain)
                }

                if filteredSuggestions.isEmpty && nextCreatableTag == nil {
                    Text("No matching tags")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(filteredSuggestions, id: \.tag) { suggestion in
                        Button {
                            draftTags = toggleTagSelection(
                                selectedTags: draftTags,
                                tag: suggestion.tag,
                                suggestions: suggestions
                            )
                        } label: {
                            TagPickerRow(
                                title: suggestion.tag,
                                isSelected: false,
                                detail: rowDetail(suggestion: suggestion)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollDismissesKeyboard(.immediately)
        .navigationTitle("Tags")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Cancel") {
                    dismiss()
                }
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button("Done") {
                    onSave(normalizeTags(values: draftTags, referenceTags: suggestions.map(\.tag)))
                    dismiss()
                }
            }
        }
    }
}
