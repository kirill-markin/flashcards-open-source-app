import MarkdownUI
import OSLog
import RaTeX
import SwiftUI
import UIKit

/*
 Accepted inline formulas stay inside their paragraph by travelling through the `MarkdownUI`
 inline image path as `fcmath:<index>-<16 hex FNV-1a of the LaTeX>` references, built by
 `reviewInlineMathImageSource(index:latex:)`. The digest is load-bearing and must not be
 simplified away: `MarkdownUI` keys its inline-image state on the raw reference string, so a
 bare `fcmath:<index>` makes two cards whose only difference is the formula parse to equal
 inline nodes, and the next card keeps showing the previous card's rendered formula.

 `MarkdownUI` has no math node and no baseline hook, and `TextInlineRenderer` composes an inline
 image as `Text(image)`, so a formula with a descent sits slightly high. That is accepted in V1.
 */

private let reviewInlineMathLogger: Logger = Logger(
    subsystem: appBundleIdentifier(),
    category: "review_math"
)
private let reviewInlineMathImageCacheLimit: Int = 256
/// Ceiling on a rasterized inline formula, in device pixels. `reviewInlineMathImageCache` is
/// capped by entry count rather than by bytes, so one very long single-line formula must not be
/// able to allocate an unbounded bitmap and hold it until the cache is cleared. Roughly 8 MB at
/// four bytes per pixel, far above any inline formula that is still readable on one line.
private let reviewInlineMathMaximumRasterPixelArea: CGFloat = 2_000_000

struct ReviewInlineMathRendering {
    let images: [String: Image]
    let didFailRendering: Bool
}

private struct ReviewInlineMathImageKey: Hashable {
    let latex: String
    let originalSource: String
    let fontSize: CGFloat
    let color: UIColor
    let displayScale: CGFloat
}

struct ReviewInlineMathImageEntry {
    let image: UIImage
    let didFailRendering: Bool
}

@MainActor
private var reviewInlineMathImageCache: [ReviewInlineMathImageKey: ReviewInlineMathImageEntry] = [:]

@MainActor
func makeReviewInlineMathRendering(
    references: [ReviewInlineMathReference],
    fontSize: CGFloat,
    color: UIColor,
    displayScale: CGFloat
) -> ReviewInlineMathRendering {
    guard references.isEmpty == false else {
        return ReviewInlineMathRendering(images: [:], didFailRendering: false)
    }

    var images: [String: Image] = [:]
    var didFailRendering = false

    for reference in references {
        let entry = reviewInlineMathImageEntry(
            formula: reference.formula,
            fontSize: fontSize,
            color: color,
            displayScale: displayScale
        )
        let label = Text(reference.formula.latex)
        images[reference.source] = entry.image.cgImage.map {
            Image($0, scale: entry.image.scale, orientation: .up, label: label)
        } ?? Image(size: CGSize(width: 1, height: 1), label: label, renderer: { _ in })
        didFailRendering = didFailRendering || entry.didFailRendering
    }

    return ReviewInlineMathRendering(images: images, didFailRendering: didFailRendering)
}

struct ReviewMathInlineImageProvider: InlineImageProvider {
    let images: [String: Image]

    // Never throws for a formula: `InlineText` drops every inline image in the paragraph when
    // the provider throws, so a failed formula falls back to an image of its delimited source.
    func image(with url: URL, label: String) async throws -> Image {
        guard url.scheme == reviewInlineMathImageScheme else {
            return try await DefaultInlineImageProvider.default.image(with: url, label: label)
        }

        return self.images[url.absoluteString] ?? Image(uiImage: UIImage())
    }
}

// A paragraph holding nothing but formulas reaches `ImageView`/`ImageFlow` instead of
// `InlineText`, which resolves images through the block image provider.
struct ReviewMathBlockImageProvider: ImageProvider {
    let images: [String: Image]

    // Keyed on the scheme, not on a successful lookup, so an unknown `fcmath:` reference fails
    // closed instead of reaching `NetworkImage` through the default provider.
    @ViewBuilder
    func makeImage(url: URL?) -> some View {
        if let url, url.scheme == reviewInlineMathImageScheme {
            self.images[url.absoluteString] ?? Image(uiImage: UIImage())
        } else {
            DefaultImageProvider.default.makeImage(url: url)
        }
    }
}

@MainActor
func reviewInlineMathImageEntry(
    formula: ReviewFormulaContent,
    fontSize: CGFloat,
    color: UIColor,
    displayScale: CGFloat
) -> ReviewInlineMathImageEntry {
    let cacheKey = ReviewInlineMathImageKey(
        latex: formula.latex,
        originalSource: formula.originalSource,
        fontSize: fontSize,
        color: color,
        displayScale: displayScale
    )
    if let cachedEntry = reviewInlineMathImageCache[cacheKey] {
        return cachedEntry
    }

    let entry = makeReviewInlineMathImageEntry(
        formula: formula,
        fontSize: fontSize,
        color: color,
        displayScale: displayScale
    )
    if reviewInlineMathImageCache.count >= reviewInlineMathImageCacheLimit {
        reviewInlineMathImageCache.removeAll()
    }
    reviewInlineMathImageCache[cacheKey] = entry
    return entry
}

@MainActor
private func makeReviewInlineMathImageEntry(
    formula: ReviewFormulaContent,
    fontSize: CGFloat,
    color: UIColor,
    displayScale: CGFloat
) -> ReviewInlineMathImageEntry {
    RaTeXFontLoader.ensureLoaded()

    do {
        let displayList = try RaTeXEngine.shared.parse(formula.latex, displayMode: false, color: color)
        let renderer = RaTeXRenderer(displayList: displayList, fontSize: fontSize)
        if let image = makeReviewInlineMathFormulaImage(
            renderer: renderer,
            displayScale: displayScale
        ), image.cgImage != nil {
            return ReviewInlineMathImageEntry(image: image, didFailRendering: false)
        }

        reviewInlineMathLogger.error(
            "Review inline formula is not rasterizable at the current size. latex=\(formula.latex, privacy: .private(mask: .hash))"
        )
    } catch {
        reviewInlineMathLogger.error(
            "Review inline formula rendering failed. latex=\(formula.latex, privacy: .private(mask: .hash)) error=\(error.localizedDescription, privacy: .public)"
        )
    }

    return ReviewInlineMathImageEntry(
        image: makeReviewInlineMathSourceImage(
            formula: formula,
            fontSize: fontSize,
            color: color,
            displayScale: displayScale
        ),
        didFailRendering: true
    )
}

@MainActor
private func makeReviewInlineMathFormulaImage(
    renderer: RaTeXRenderer,
    displayScale: CGFloat
) -> UIImage? {
    let size = CGSize(width: renderer.width, height: renderer.totalHeight)
    let scale = max(displayScale, 1)
    guard size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0,
          size.width * size.height * scale * scale <= reviewInlineMathMaximumRasterPixelArea else {
        return nil
    }

    return makeReviewInlineMathRenderedImage(size: size, displayScale: displayScale) { context in
        renderer.draw(in: context)
    }
}

@MainActor
private func makeReviewInlineMathSourceImage(
    formula: ReviewFormulaContent,
    fontSize: CGFloat,
    color: UIColor,
    displayScale: CGFloat
) -> UIImage {
    let attributes: [NSAttributedString.Key: Any] = [
        .font: UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular),
        .foregroundColor: color
    ]
    let source = formula.originalSource as NSString
    let sourceSize = source.size(withAttributes: attributes)
    let height = max(sourceSize.height.rounded(.up), 1)
    // This fallback draws the raw source, so the same ceiling has to bound it too: without the
    // clamp, refusing an over-sized formula bitmap would just move the allocation here.
    let scale = max(displayScale, 1)
    let maximumWidth = (reviewInlineMathMaximumRasterPixelArea / (height * scale * scale)).rounded(.down)
    let size = CGSize(
        width: min(max(sourceSize.width.rounded(.up), 1), max(maximumWidth, 1)),
        height: height
    )

    return makeReviewInlineMathRenderedImage(size: size, displayScale: displayScale) { _ in
        source.draw(at: .zero, withAttributes: attributes)
    }
}

@MainActor
private func makeReviewInlineMathRenderedImage(
    size: CGSize,
    displayScale: CGFloat,
    draw: (CGContext) -> Void
) -> UIImage {
    let format = UIGraphicsImageRendererFormat.preferred()
    format.opaque = false
    if displayScale > 0 {
        format.scale = displayScale
    }

    return UIGraphicsImageRenderer(size: size, format: format).image { context in
        draw(context.cgContext)
    }
}
