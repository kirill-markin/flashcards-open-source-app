import SwiftUI
import UIKit

struct ReviewSelectableCodeBlock: UIViewRepresentable {
    let code: String
    let font: UIFont

    func makeUIView(context: Context) -> ReviewSelectionTextView {
        let view = ReviewSelectionTextView(usingTextLayoutManager: true)
        view.forwardsSelectAllToWholeSide = true
        view.isEditable = false
        view.isSelectable = true
        view.delegate = view
        view.isScrollEnabled = false
        view.backgroundColor = .secondarySystemBackground
        view.textColor = .label
        view.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: ReviewSelectionTextView, context: Context) {
        if view.font != self.font { view.font = self.font }
        if view.text != self.code {
            view.text = self.code
            view.rebuildAccessibilityContent()
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ReviewSelectionTextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        return uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    }
}
