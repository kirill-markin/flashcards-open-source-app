import SwiftUI
import UIKit

struct ReviewSelectableCodeBlock: UIViewRepresentable {
    let code: String
    let font: UIFont

    func makeUIView(context: Context) -> ReviewCodeBlockScrollView {
        let scrollView = ReviewCodeBlockScrollView()
        scrollView.backgroundColor = .secondarySystemBackground
        scrollView.layer.cornerRadius = reviewContentSurfaceCornerRadius / 2
        scrollView.layer.cornerCurve = .continuous
        scrollView.clipsToBounds = true
        scrollView.showsVerticalScrollIndicator = false
        scrollView.isDirectionalLockEnabled = true
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.scrollsToTop = false
        let view = scrollView.textView
        view.forwardsSelectAllToWholeSide = true
        view.isEditable = false
        view.isSelectable = true
        view.delegate = view
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textColor = .label
        view.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        scrollView.addSubview(view)
        return scrollView
    }

    func updateUIView(_ scrollView: ReviewCodeBlockScrollView, context: Context) {
        let view = scrollView.textView
        if view.font != self.font {
            view.font = self.font
            scrollView.invalidateUnwrappedTextSize()
        }
        if view.text != self.code {
            view.text = self.code
            view.rebuildAccessibilityContent()
            scrollView.invalidateUnwrappedTextSize()
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ReviewCodeBlockScrollView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        return CGSize(width: width, height: uiView.unwrappedTextSize().height)
    }
}

/// Lays the code out on unwrapped lines; lines wider than the block scroll horizontally.
final class ReviewCodeBlockScrollView: UIScrollView {
    let textView = ReviewSelectionTextView(usingTextLayoutManager: true)
    /// Cached because a horizontal scroll runs `layoutSubviews` on every frame. Keyed by font
    /// so a Dynamic Type font the text view adjusts by itself is re-measured too.
    private var measurement: (font: UIFont?, size: CGSize)?

    func unwrappedTextSize() -> CGSize {
        if let measurement = self.measurement, measurement.font == self.textView.font { return measurement.size }
        let size = self.textView.sizeThatFits(CGSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude))
        let roundedSize = CGSize(width: size.width.rounded(.up), height: size.height.rounded(.up))
        self.measurement = (font: self.textView.font, size: roundedSize)
        return roundedSize
    }

    func invalidateUnwrappedTextSize() {
        self.measurement = nil
        self.setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let size = self.unwrappedTextSize()
        self.textView.frame = CGRect(origin: .zero, size: size)
        self.contentSize = size
    }
}
