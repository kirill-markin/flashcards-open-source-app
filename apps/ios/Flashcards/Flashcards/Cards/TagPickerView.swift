import SwiftUI

private let reviewCardsStringsTableName: String = "ReviewCards"

struct TagsFieldRow: View {
    let summary: String

    var body: some View {
        HStack {
            Text(String(localized: "Tags", table: reviewCardsStringsTableName))
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

            TextField(String(localized: "Add or filter tags", table: reviewCardsStringsTableName), text: $searchText)
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
                Section {
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
                } header: {
                    Text(String(localized: "Selected", table: reviewCardsStringsTableName))
                }
            }

            Section {
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
                            title: String(
                                format: String(localized: "Create \"%@\"", table: reviewCardsStringsTableName),
                                locale: Locale.current,
                                nextCreatableTag
                            ),
                            isSelected: false,
                            detail: .label(String(localized: "New", table: reviewCardsStringsTableName))
                        )
                    }
                    .buttonStyle(.plain)
                }

                if filteredSuggestions.isEmpty && nextCreatableTag == nil {
                    Text(String(localized: "No matching tags", table: reviewCardsStringsTableName))
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
            } header: {
                Text(String(localized: "Suggestions", table: reviewCardsStringsTableName))
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(String(localized: "Tags", table: reviewCardsStringsTableName))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(String(localized: "Cancel", table: reviewCardsStringsTableName)) {
                    dismiss()
                }
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button(String(localized: "Done", table: reviewCardsStringsTableName)) {
                    onSave(normalizeTags(values: draftTags, referenceTags: suggestions.map(\.tag)))
                    dismiss()
                }
            }
        }
    }
}

func localizedTagSelectionSummary(tags: [String]) -> String {
    if tags.isEmpty {
        return localizedNoTagsLabel()
    }

    if tags.count <= 2 {
        return tags.joined(separator: ", ")
    }

    return "\(tags[0]), \(tags[1]) +\((tags.count - 2).formatted())"
}
