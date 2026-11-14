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
                .allowsHitTesting(false)

            TextField(String(localized: "Add or filter tags", table: reviewCardsStringsTableName), text: $searchText)
                #if !targetEnvironment(macCatalyst)
                .textFieldStyle(.plain)
                #endif
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
                        .frame(minWidth: appMinimumTouchTarget, minHeight: appMinimumTouchTarget)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(String(localized: "text_input.clear", table: "Foundation"))
            }
        }
        #if !targetEnvironment(macCatalyst)
        .frame(minHeight: appMinimumTouchTarget)
        .padding(.leading, 12)
        .padding(.trailing, self.searchText.isEmpty ? 12 : 0)
        .padding(.vertical, 2)
        .nativeTextInputFocusTarget(isFocused: self.$isInputFocused)
        .nativeTextInputBackground(cornerRadius: 24)
        .listRowBackground(Color.clear)
        #endif
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
        #if targetEnvironment(macCatalyst)
        .frame(minHeight: appMinimumTouchTarget)
        #endif
        .contentShape(Rectangle())
    }
}

struct TagPickerView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.sectionChildPresentationStyle) private var presentationStyle: SectionChildPresentationStyle

    let suggestions: [TagSuggestion]
    @Binding private var selectedTags: [String]
    @State private var observedTags: [String]
    @State private var draftTags: [String]
    @State private var searchText: String = ""
    @FocusState private var isInputFocused: Bool

    init(selectedTags: Binding<[String]>, suggestions: [TagSuggestion]) {
        let normalizedSuggestions = normalizeTagSuggestions(suggestions: suggestions)
        let normalizedTags = normalizeTags(
            values: selectedTags.wrappedValue,
            referenceTags: normalizedSuggestions.map(\.tag)
        )
        self.suggestions = normalizedSuggestions
        self._selectedTags = selectedTags
        self._observedTags = State(initialValue: normalizedTags)
        self._draftTags = State(initialValue: normalizedTags)
    }

    private var sourceTags: [String] {
        normalizeTags(values: selectedTags, referenceTags: suggestions.map(\.tag))
    }

    private func reconcileTagsWithSelection() {
        let refreshedTags = self.sourceTags
        self.draftTags = reconcileDraftTags(
            draftTags: self.draftTags,
            observedTags: self.observedTags,
            refreshedTags: refreshedTags
        )
        self.observedTags = refreshedTags
    }

    private func addTag(_ tag: String) {
        self.reconcileTagsWithSelection()
        self.draftTags = normalizeTags(values: self.draftTags + [tag], referenceTags: self.suggestions.map(\.tag))
    }

    private func removeTag(_ tag: String) {
        self.reconcileTagsWithSelection()
        let key = normalizeTagKey(tag: tag)
        self.draftTags.removeAll { normalizeTagKey(tag: $0) == key }
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

        self.addTag(nextCreatableTag)
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
                            self.removeTag(suggestion.tag)
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
                        self.addTag(nextCreatableTag)
                        searchText = ""
                    } label: {
                        TagPickerRow(
                            title: String(
                                format: String(localized: "Create \"%@\"", table: reviewCardsStringsTableName),
                                locale: Locale.current,
                                nextCreatableTag
                            ),
                            isSelected: false,
                            detail: .label(
                                String(
                                    localized: "cards.tag_picker.new_tag_badge",
                                    defaultValue: "New",
                                    table: reviewCardsStringsTableName,
                                    comment: "Badge on the tag picker row that creates a tag not yet in the workspace; agrees with the singular word for tag"
                                )
                            )
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
                            self.addTag(suggestion.tag)
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
        .onChange(of: self.sourceTags) {
            self.reconcileTagsWithSelection()
        }
        .pageNavigationTitle(String(localized: "Tags", table: reviewCardsStringsTableName))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // Pushed into a section, Back leaves the tags unapplied.
            if self.presentationStyle == .sheet {
                ToolbarItem(placement: .topBarLeading) {
                    Button(String(localized: "Cancel", table: reviewCardsStringsTableName)) {
                        dismiss()
                    }
                }
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button(String(localized: "Done", table: reviewCardsStringsTableName)) {
                    self.reconcileTagsWithSelection()
                    self.selectedTags = normalizeTags(values: draftTags, referenceTags: suggestions.map(\.tag))
                    dismiss()
                }
            }
        }
        .sectionChildBackGuard(isLocked: false, hasUnsavedChanges: self.hasUnsavedChanges, onDiscard: { self.dismiss() })
    }

    /// Whether the draft differs from the tags it would replace, in any order.
    private var hasUnsavedChanges: Bool {
        Set(self.draftTags.map { normalizeTagKey(tag: $0) }) != Set(self.sourceTags.map { normalizeTagKey(tag: $0) })
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
