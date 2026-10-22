import SwiftUI
import UIKit

@MainActor
struct ReviewSelectableTableContent {
    let identity: Int
    private let columns: [PresentationIntent.TableColumn]
    private var cells: [Int: [NSMutableAttributedString]] = [:]

    init(identity: Int, columns: [PresentationIntent.TableColumn]) {
        self.identity = identity
        self.columns = columns
    }

    mutating func cell(row: Int, column: Int) -> NSMutableAttributedString {
        let rowCells = self.cells[row] ?? self.columns.map { _ in NSMutableAttributedString() }
        self.cells[row] = rowCells
        return rowCells[column]
    }

    var rows: [[NSAttributedString]] {
        guard let lastRow = self.cells.keys.max() else { return [] }
        return (0...lastRow).map { row in
            self.cells[row]?.map { NSAttributedString(attributedString: $0) }
                ?? self.columns.map { _ in NSAttributedString(string: "") }
        }
    }

    var copyText: String {
        self.rows.map { row in
            row.map(\.reviewSelectionCopyText).joined(separator: "\t")
        }.joined(separator: "\n")
    }
}

struct ReviewSelectableTable: UIViewRepresentable {
    let rows: [[NSAttributedString]]
    @State private var attachmentLayoutVersion = 0

    func makeUIView(context: Context) -> ReviewSelectableTableView {
        ReviewSelectableTableView(rows: self.rows)
    }

    func updateUIView(_ view: ReviewSelectableTableView, context: Context) {
        _ = self.attachmentLayoutVersion
        for row in view.cells {
            for cell in row {
                cell.onAttachmentSizeChange = { self.attachmentLayoutVersion += 1 }
            }
        }
        view.setNeedsLayout()
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ReviewSelectableTableView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        return uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    }
}

final class ReviewSelectableTableView: UIView {
    let cells: [[ReviewSelectionTextView]]

    init(rows: [[NSAttributedString]]) {
        self.cells = rows.map { row in
            row.map { content in
                let cell = ReviewSelectionTextView(usingTextLayoutManager: true)
                cell.forwardsSelectAllToWholeSide = true
                cell.isEditable = false
                cell.isSelectable = true
                cell.delegate = cell
                cell.isScrollEnabled = false
                cell.backgroundColor = .clear
                cell.textContainerInset = UIEdgeInsets(top: 6, left: 6, bottom: 6, right: 6)
                cell.textContainer.lineFragmentPadding = 0
                cell.adjustsFontForContentSizeCategory = true
                cell.font = UIFont.preferredFont(forTextStyle: .body)
                #if targetEnvironment(macCatalyst)
                let cellContent = NSMutableAttributedString(attributedString: content)
                content.enumerateAttribute(.attachment, in: NSRange(location: 0, length: content.length)) { value, range, _ in
                    guard let attachment = value as? ReviewContentAttachment else { return }
                    cellContent.addAttribute(.attachment, value: attachment.copyForTableCell(), range: range)
                }
                cell.applyReviewContent(cellContent)
                #else
                cell.applyReviewContent(content)
                #endif
                cell.rebuildAccessibilityContent()
                cell.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
                cell.layer.borderWidth = 0.5
                return cell
            }
        }
        super.init(frame: .zero)
        self.isAccessibilityElement = false
        for row in self.cells {
            for cell in row { self.addSubview(cell) }
        }
        self.accessibilityElements = Array(self.cells.joined())
        self.registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: ReviewSelectableTableView, _: UITraitCollection) in
            view.updateBorderColors()
        }
        self.updateBorderColors()
    }

    required init?(coder: NSCoder) { nil }

    private func updateBorderColors() {
        for row in self.cells {
            for cell in row { cell.layer.borderColor = UIColor.separator.resolvedColor(with: self.traitCollection).cgColor }
        }
    }

    private func rowHeights(width: CGFloat) -> [CGFloat] {
        self.cells.map { row in
            let cellWidth = width / CGFloat(max(row.count, 1))
            return row.reduce(CGFloat(32)) { height, cell in
                max(height, ceil(cell.sizeThatFits(CGSize(width: cellWidth, height: .greatestFiniteMagnitude)).height))
            }
        }
    }

    override func sizeThatFits(_ size: CGSize) -> CGSize {
        CGSize(width: size.width, height: self.rowHeights(width: size.width).reduce(0, +))
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard self.bounds.width > 0 else { return }
        let heights = self.rowHeights(width: self.bounds.width)
        var y: CGFloat = 0
        for (index, row) in self.cells.enumerated() {
            let cellWidth = self.bounds.width / CGFloat(max(row.count, 1))
            for (column, cell) in row.enumerated() {
                cell.frame = CGRect(x: CGFloat(column) * cellWidth, y: y, width: cellWidth, height: heights[index])
            }
            y += heights[index]
        }
    }
}
