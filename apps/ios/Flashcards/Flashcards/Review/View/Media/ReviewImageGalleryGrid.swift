import SwiftUI

private let reviewImageGallerySpacing: CGFloat = 8

/// Lays out the images of one image-only Markdown paragraph in equal-width columns.
/// Cells are built by the caller so each keeps its own retained state across re-renders.
struct ReviewImageGalleryGrid<Cell: View>: View {
    let cells: [Cell]

    var body: some View {
        let columnCount = reviewImageGalleryColumnCount(imageCount: self.cells.count)

        Grid(horizontalSpacing: reviewImageGallerySpacing, verticalSpacing: reviewImageGallerySpacing) {
            ForEach(Array(stride(from: 0, to: self.cells.count, by: columnCount)), id: \.self) { rowStart in
                GridRow {
                    ForEach(rowStart..<min(rowStart + columnCount, self.cells.count), id: \.self) { index in
                        self.cells[index]
                            .frame(maxWidth: .infinity, alignment: .center)
                    }
                }
            }
        }
    }
}

func reviewImageGalleryColumnCount(imageCount: Int) -> Int {
    switch imageCount {
    case 2, 4:
        return 2
    default:
        return 3
    }
}
