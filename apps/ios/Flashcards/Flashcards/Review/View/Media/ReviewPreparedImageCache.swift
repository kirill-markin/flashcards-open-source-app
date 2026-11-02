import Foundation
import Observation
import OSLog
import UIKit

/*
 Decoded images of the shown card and the prepared next card, so the card a rating shows next
 and a revealed back side render their images on the first frame instead of a placeholder.
 See docs/fsrs-scheduling-logic.md#non-blocking-review
 */

private let reviewPreparedImageLogger: Logger = Logger(
    subsystem: appBundleIdentifier(),
    category: "review_prepared_images"
)

struct ReviewPreparedImage {
    let mediaAsset: MediaAsset
    let image: UIImage
}

struct ReviewImagePreparationSide {
    let cardId: String
    let content: ReviewRenderedContent
}

@MainActor
@Observable
final class ReviewPreparedImageCache {
    /// cardId -> mediaAssetId -> asset; decoded images are shared by sha256 across assets and cards.
    private var mediaAssetsByCardId: [String: [String: MediaAsset]] = [:]
    private var imagesBySha256: [String: UIImage] = [:]

    func preparedImage(mediaAssetId: String) -> ReviewPreparedImage? {
        guard let mediaAsset = self.preparedMediaAsset(mediaAssetId: mediaAssetId),
              let image = self.imagesBySha256[mediaAsset.sha256] else {
            return nil
        }

        return ReviewPreparedImage(mediaAsset: mediaAsset, image: image)
    }

    func releaseImagesOutside(cardIds: Set<String>) {
        let keptMediaAssetsByCardId = self.mediaAssetsByCardId.filter { cardId, _ in
            cardIds.contains(cardId)
        }
        guard keptMediaAssetsByCardId.count != self.mediaAssetsByCardId.count else {
            return
        }

        let keptSha256 = Set(keptMediaAssetsByCardId.values.flatMap { mediaAssets in
            mediaAssets.values.map(\.sha256)
        })
        self.mediaAssetsByCardId = keptMediaAssetsByCardId
        self.imagesBySha256 = self.imagesBySha256.filter { sha256, _ in
            keptSha256.contains(sha256)
        }
    }

    /// Media views pick a prepared image by mediaAssetId alone, so the shown card claims the prepared images
    /// its sides display before a release can drop them from under it.
    func retainPreparedImages(for sides: [ReviewImagePreparationSide]) {
        for side in sides {
            for reference in reviewManagedMediaReferences(content: side.content) where reference.state == .ready {
                self.registerPreparedImage(cardId: side.cardId, mediaAssetId: reference.mediaAssetId)
            }
        }
    }

    /// Prepares the sides in order; a failed lookup, download, or decode leaves that image to the on-screen loading path.
    func prepareReviewImages(for sides: [ReviewImagePreparationSide], store: FlashcardsStore) async {
        for side in sides {
            for reference in reviewManagedMediaReferences(content: side.content) where reference.state == .ready {
                guard Task.isCancelled == false else {
                    return
                }
                await self.prepareReviewImage(cardId: side.cardId, reference: reference, store: store)
            }
        }
    }

    private func prepareReviewImage(
        cardId: String,
        reference: ReviewManagedMediaReference,
        store: FlashcardsStore
    ) async {
        guard self.registerPreparedImage(cardId: cardId, mediaAssetId: reference.mediaAssetId) == false else {
            return
        }

        // The store reports lookup and download failures itself.
        let loadResult = await store.loadReviewManagedMedia(mediaAssetId: reference.mediaAssetId)
        guard Task.isCancelled == false,
              let mediaAsset = loadResult.mediaAsset,
              let mediaURL = loadResult.mediaURL,
              mediaURL.isFileURL,
              ReviewManagedMediaCategory(mimeType: mediaAsset.mimeType, isImageSyntax: reference.isImageSyntax) == .image else {
            return
        }

        if self.imagesBySha256[mediaAsset.sha256] == nil {
            let image = await decodeReviewManagedFileImage(mediaURL: mediaURL)
            guard Task.isCancelled == false else {
                return
            }
            guard let image else {
                reviewPreparedImageLogger.error(
                    """
                    event=review_image_preparation_decode_failed \
                    mediaAssetId=\(mediaAsset.mediaAssetId, privacy: .public) \
                    mimeType=\(mediaAsset.mimeType, privacy: .public) \
                    sizeBytes=\(mediaAsset.sizeBytes, privacy: .public)
                    """
                )
                return
            }
            self.imagesBySha256[mediaAsset.sha256] = image
        }
        self.mediaAssetsByCardId[cardId, default: [:]][reference.mediaAssetId] = mediaAsset
    }

    /// Returns whether the card now holds an already decoded image for the asset.
    @discardableResult
    private func registerPreparedImage(cardId: String, mediaAssetId: String) -> Bool {
        guard self.mediaAssetsByCardId[cardId]?[mediaAssetId] == nil else {
            return true
        }
        guard let preparedMediaAsset = self.preparedMediaAsset(mediaAssetId: mediaAssetId) else {
            return false
        }

        self.mediaAssetsByCardId[cardId, default: [:]][mediaAssetId] = preparedMediaAsset
        return true
    }

    private func preparedMediaAsset(mediaAssetId: String) -> MediaAsset? {
        for mediaAssets in self.mediaAssetsByCardId.values {
            if let mediaAsset = mediaAssets[mediaAssetId] {
                return mediaAsset
            }
        }

        return nil
    }
}

private func reviewManagedMediaReferences(content: ReviewRenderedContent) -> [ReviewManagedMediaReference] {
    guard case .managedMarkdown(let managedContent) = content else {
        return []
    }

    return managedContent.blocks.compactMap { block in
        guard case .managedMedia(let reference) = block else {
            return nil
        }
        return reference
    }
}
