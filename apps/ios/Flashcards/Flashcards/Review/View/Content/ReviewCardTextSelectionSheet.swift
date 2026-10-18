import SwiftUI
import UIKit

struct ReviewCardTextSelection: Identifiable {
    let id: UUID
    let cardId: String
    let title: String
    let sourceText: String
}

struct ReviewCardTextSelectionSheet: View {
    @Environment(\.dismiss) private var dismiss

    let selection: ReviewCardTextSelection

    var body: some View {
        NavigationStack {
            ReviewCardSelectableTextView(
                sourceText: self.selection.sourceText,
                accessibilityLabel: self.selection.title
            )
            .navigationTitle(self.selection.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Done", table: "ReviewCards")) {
                        self.dismiss()
                    }
                    .accessibilityIdentifier(UITestIdentifier.reviewTextSelectionDoneButton)
                }
            }
        }
    }
}

private struct ReviewCardSelectableTextView: UIViewRepresentable {
    let sourceText: String
    let accessibilityLabel: String

    func makeUIView(context: Context) -> UITextView {
        let textView = ReviewSelectionTextView(usingTextLayoutManager: true)
        textView.isEditable = false
        textView.isSelectable = true
        textView.delegate = textView
        textView.isScrollEnabled = true
        textView.font = UIFont.preferredFont(forTextStyle: .body)
        textView.adjustsFontForContentSizeCategory = true
        textView.backgroundColor = .systemBackground
        textView.textColor = .label
        textView.textAlignment = .natural
        textView.textContainerInset = UIEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
        textView.textContainer.lineFragmentPadding = 0
        textView.text = self.sourceText
        textView.accessibilityLabel = self.accessibilityLabel
        textView.accessibilityIdentifier = UITestIdentifier.reviewTextSelectionTextView
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {
        if textView.text != self.sourceText {
            textView.text = self.sourceText
        }
        textView.accessibilityLabel = self.accessibilityLabel
    }
}
