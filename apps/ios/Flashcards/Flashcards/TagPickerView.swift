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
    let title: String
    let isSelected: Bool
    let detailText: String?

    var body: some View {
        HStack {
            Text(title)
            Spacer()

            if let detailText {
                Text(detailText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if isSelected {
                Image(systemName: "checkmark")
                    .foregroundStyle(.tint)
            }
        }
    }
}

struct TagPickerView: View {
    @Environment(\.dismiss) private var dismiss

    let suggestions: [String]
    let onSave: ([String]) -> Void

    @State private var draftTags: [String]
    @State private var searchText: String
    @FocusState private var isInputFocused: Bool

    init(selectedTags: [String], suggestions: [String], onSave: @escaping ([String]) -> Void) {
        let normalizedSuggestions = normalizeTags(values: suggestions, referenceTags: [])
        self.suggestions = normalizedSuggestions
        self.onSave = onSave
        self._draftTags = State(initialValue: normalizeTags(values: selectedTags, referenceTags: normalizedSuggestions))
        self._searchText = State(initialValue: "")
    }

    private var filteredSuggestions: [String] {
        filterTagSuggestions(
            suggestions: suggestions,
            selectedTags: draftTags,
            searchText: searchText
        )
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
                    ForEach(draftTags, id: \.self) { tag in
                        Button {
                            draftTags = toggleTagSelection(
                                selectedTags: draftTags,
                                tag: tag,
                                suggestions: suggestions
                            )
                        } label: {
                            TagPickerRow(title: tag, isSelected: true, detailText: nil)
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
                            detailText: "New"
                        )
                    }
                    .buttonStyle(.plain)
                }

                if filteredSuggestions.isEmpty && nextCreatableTag == nil {
                    Text("No matching tags")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(filteredSuggestions, id: \.self) { tag in
                        Button {
                            draftTags = toggleTagSelection(
                                selectedTags: draftTags,
                                tag: tag,
                                suggestions: suggestions
                            )
                        } label: {
                            TagPickerRow(title: tag, isSelected: false, detailText: nil)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
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
                    onSave(normalizeTags(values: draftTags, referenceTags: suggestions))
                    dismiss()
                }
            }
        }
    }
}
