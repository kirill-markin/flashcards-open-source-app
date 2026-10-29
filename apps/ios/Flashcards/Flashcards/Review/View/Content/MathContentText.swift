import SwiftUI
import UIKit

/// Keeps native text fast paths and row gestures while sharing Review's parser, formulas,
/// TextKit selection, source copying and accessibility for accepted LaTeX.
struct MathContentText: View {
    let text: String
    var textStyle: UIFont.TextStyle = .body
    var weight: UIFont.Weight = .regular
    var color: UIColor = .label
    var isSelectable: Bool = false
    var isInteractive: Bool = false
    var lineLimit: Int? = nil
    var parsedBlocks: [ReviewMathBlock]? = nil

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var mathBlocks: [ReviewMathBlock]? {
        if let parsedBlocks { return parsedBlocks }
        guard containsReviewMathDelimiter(text: text) else { return nil }
        guard case .segmented(let blocks) = extractReviewMathBlocks(text: text) else { return nil }
        return blocks
    }

    var body: some View {
        let traits = UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(self.dynamicTypeSize))
        let size = UIFont.preferredFont(forTextStyle: self.textStyle, compatibleWith: traits).pointSize
        let font = UIFont.systemFont(ofSize: size, weight: self.weight)
        if let blocks = self.mathBlocks, blocks.contains(where: { if case .formula = $0 { return true }; return false }) {
            ReviewSelectableTextView(
                sourceText: self.text, content: .mathText(blocks), surfaceStyle: .back,
                textFont: font, textColor: self.color, isSelectable: self.isSelectable, lineLimit: self.lineLimit
            )
            .allowsHitTesting(self.isSelectable || self.isInteractive)
        } else {
            Text(verbatim: self.text)
                .font(Font(font))
                .foregroundStyle(Color(uiColor: self.color))
                .lineLimit(self.lineLimit)
        }
    }
}
