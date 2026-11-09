import AVKit
import ImageIO
import SwiftUI
import UIKit

private let reviewManagedMediaStringsTableName: String = "ReviewCards"
private let reviewManagedMediaCornerRadius: CGFloat = reviewContentSurfaceCornerRadius / 2
private let reviewManagedImagePresentationMaxWidth: CGFloat = 520
private let reviewManagedImagePlaceholderAspectRatio: CGFloat = 4.0 / 3.0
/// The smallest height at which AVKit shows its full inline controls for audio: measured, not documented.
private let reviewManagedAudioHeight: CGFloat = 177
private let reviewManagedVideoMinHeight: CGFloat = 190

enum ReviewManagedMediaCategory {
    case image
    case audio
    case video
    case attachment

    init(mimeType: String?, isImageSyntax: Bool) {
        guard let mimeType else {
            self = isImageSyntax ? .image : .attachment
            return
        }

        let normalizedMimeType = mimeType.lowercased()
        if normalizedMimeType.hasPrefix("image/") {
            self = .image
        } else if normalizedMimeType.hasPrefix("audio/") {
            self = .audio
        } else if normalizedMimeType.hasPrefix("video/") {
            self = .video
        } else {
            self = .attachment
        }
    }
}

struct ReviewManagedMediaTaskID: Hashable {
    let mediaAssetId: String
    let state: ManagedMediaAssetReferenceState
    let workspaceId: String?

    init(
        mediaAssetId: String,
        state: ManagedMediaAssetReferenceState,
        workspaceId: String?
    ) {
        self.mediaAssetId = mediaAssetId
        self.state = state
        self.workspaceId = workspaceId
    }
}

struct ReviewManagedMediaView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(ReviewPreparedImageCache.self) private var preparedImageCache: ReviewPreparedImageCache?

    let reference: ReviewManagedMediaReference
    let surfaceStyle: ReviewCardSurfaceStyle

    @State private var retainedState: ReviewManagedMediaState
    @State private var presentationID: UUID?

    init(reference: ReviewManagedMediaReference, surfaceStyle: ReviewCardSurfaceStyle) {
        self.init(reference: reference, surfaceStyle: surfaceStyle, retainedState: ReviewManagedMediaState())
    }

    init(reference: ReviewManagedMediaReference, surfaceStyle: ReviewCardSurfaceStyle, retainedState: ReviewManagedMediaState) {
        self.reference = reference
        self.surfaceStyle = surfaceStyle
        self._retainedState = State(initialValue: retainedState)
    }

    private var loadResult: ReviewManagedMediaLoadResult? { self.retainedState.loadResult }
    private var isLoading: Bool { self.retainedState.isLoading }
    private var presentedPlayer: AVPlayer? {
        guard let presentationID = self.presentationID,
              self.retainedState.activePresentationID == presentationID else { return nil }
        return self.retainedState.player
    }

    var body: some View {
        Group {
            switch reference.state {
            case .pending:
                generatedImagePendingView
            case .failed:
                generatedImageFailedView
            case .ready:
                if let preparedImage = self.preparedImageCache?.preparedImage(mediaAssetId: reference.mediaAssetId) {
                    preparedImageView(preparedImage: preparedImage)
                } else {
                    loadedMediaView
                }
            }
        }
        .background {
            ReviewMediaPresentation { id, isPresented in
                if isPresented {
                    self.presentationID = id
                }
                self.retainedState.setPresented(isPresented, id: id, store: self.store)
            }
        }
    }

    /// Loads only when no prepared image exists, so a prepared card renders without a lookup.
    private var loadedMediaView: some View {
        Group {
            if isLoading {
                initialLoadingView
            } else if let loadResult,
                      let mediaAsset = loadResult.mediaAsset,
                      let mediaURL = loadResult.mediaURL {
                readyView(mediaAsset: mediaAsset, mediaURL: mediaURL)
            } else {
                unavailableView(unavailableReason: loadResult?.unavailableReason)
            }
        }
        .task(id: taskID) { self.retainedState.load(request: self.taskID, store: self.store) }
        .onChange(of: unavailableMediaRefreshVersion) { previousVersion, version in
            guard previousVersion != nil, version != nil else { return }
            self.retainedState.load(request: self.taskID, store: self.store)
        }
    }

    /// A missing registry row or cache file can arrive with any local read; available media never reloads per rating.
    private var unavailableMediaRefreshVersion: Int? {
        guard isLoading == false, loadResult?.mediaURL == nil else {
            return nil
        }

        return store.localReadVersion
    }

    private func preparedImageView(preparedImage: ReviewPreparedImage) -> some View {
        reviewManagedImageView(
            image: Image(uiImage: preparedImage.image),
            accessibilityLabel: mediaDescription(mediaAsset: preparedImage.mediaAsset),
            aspectRatio: reviewManagedImageAspectRatio(size: preparedImage.image.size)
        )
    }

    private var taskID: ReviewManagedMediaTaskID {
        ReviewManagedMediaTaskID(
            mediaAssetId: reference.mediaAssetId,
            state: reference.state,
            workspaceId: store.workspace?.workspaceId
        )
    }

    @ViewBuilder
    private var initialLoadingView: some View {
        if reference.isImageSyntax {
            imageLoadingView(aspectRatio: reviewManagedImagePlaceholderAspectRatio)
        } else {
            loadingView
        }
    }

    private var loadingMediaLabel: String {
        String(localized: "Loading media...", table: reviewManagedMediaStringsTableName)
    }

    private var loadingView: some View {
        HStack(spacing: 10) {
            ProgressView()
                .controlSize(.small)
            Text(loadingMediaLabel)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(mediaBackgroundStyle, in: RoundedRectangle(cornerRadius: reviewManagedMediaCornerRadius))
    }

    private func imageLoadingView(aspectRatio: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: reviewManagedMediaCornerRadius)
            .fill(mediaBackgroundStyle)
            .aspectRatio(aspectRatio, contentMode: .fit)
            .frame(maxWidth: reviewManagedImagePresentationMaxWidth)
            .frame(maxWidth: .infinity, alignment: .center)
            .overlay {
                ProgressView(loadingMediaLabel)
                    .controlSize(.regular)
                    .labelsHidden()
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(loadingMediaLabel)
    }

    private var generatedImagePendingView: some View {
        RoundedRectangle(cornerRadius: reviewManagedMediaCornerRadius)
            .fill(mediaBackgroundStyle)
            .aspectRatio(reviewManagedImagePlaceholderAspectRatio, contentMode: .fit)
            .frame(maxWidth: reviewManagedImagePresentationMaxWidth)
            .frame(maxWidth: .infinity, alignment: .center)
            .overlay {
                VStack(spacing: 10) {
                    ProgressView()
                        .controlSize(.regular)
                    Text(generatedImageProcessingLabel)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(12)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(generatedImageAccessibilityLabel)
            .accessibilityValue(generatedImageProcessingLabel)
    }

    private var generatedImageFailedView: some View {
        RoundedRectangle(cornerRadius: reviewManagedMediaCornerRadius)
            .fill(mediaBackgroundStyle)
            .aspectRatio(reviewManagedImagePlaceholderAspectRatio, contentMode: .fit)
            .frame(maxWidth: reviewManagedImagePresentationMaxWidth)
            .frame(maxWidth: .infinity, alignment: .center)
            .overlay {
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.title2)
                        .foregroundStyle(.orange)
                    Text(generatedImageFailureLabel)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(12)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(generatedImageAccessibilityLabel)
            .accessibilityValue(generatedImageFailureLabel)
    }

    private var generatedImageAccessibilityLabel: String {
        if let label = reference.label, label.isEmpty == false {
            return label
        }

        return String(localized: "Managed image", table: reviewManagedMediaStringsTableName)
    }

    private var generatedImageProcessingLabel: String {
        String(localized: "Processing image...", table: reviewManagedMediaStringsTableName)
    }

    private var generatedImageFailureLabel: String {
        String(localized: "Image couldn't be attached", table: reviewManagedMediaStringsTableName)
    }

    private func readyView(mediaAsset: MediaAsset, mediaURL: URL) -> some View {
        let category = ReviewManagedMediaCategory(
            mimeType: mediaAsset.mimeType,
            isImageSyntax: reference.isImageSyntax
        )

        return Group {
            switch category {
            case .image:
                imageView(mediaAsset: mediaAsset, mediaURL: mediaURL)
            case .audio:
                ReviewManagedMediaPlayer(player: self.presentedPlayer, delegate: self.retainedState.fullScreenDelegate)
                    .frame(maxWidth: .infinity, minHeight: reviewManagedAudioHeight)
                    .clipShape(RoundedRectangle(cornerRadius: reviewManagedMediaCornerRadius))
                    .accessibilityLabel(displayLabel(mediaAsset: mediaAsset, category: .audio))
            case .video:
                ReviewManagedMediaPlayer(player: self.presentedPlayer, delegate: self.retainedState.fullScreenDelegate)
                    .frame(maxWidth: .infinity, minHeight: reviewManagedVideoMinHeight)
                    .clipShape(RoundedRectangle(cornerRadius: reviewManagedMediaCornerRadius))
                    .accessibilityLabel(displayLabel(mediaAsset: mediaAsset, category: .video))
            case .attachment:
                Link(destination: mediaURL) {
                    Label(displayLabel(mediaAsset: mediaAsset, category: .attachment), systemImage: "paperclip")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                }
                .background(mediaBackgroundStyle, in: RoundedRectangle(cornerRadius: reviewManagedMediaCornerRadius))
            }
        }
    }

    @ViewBuilder
    private func imageView(mediaAsset: MediaAsset, mediaURL: URL) -> some View {
        let accessibilityLabel = mediaDescription(mediaAsset: mediaAsset)

        if mediaURL.isFileURL {
            Group {
                if let image = self.retainedState.decodedImage, self.retainedState.decodedImageURL == mediaURL {
                    self.reviewManagedImageView(image: Image(uiImage: image), accessibilityLabel: accessibilityLabel, aspectRatio: reviewManagedImageAspectRatio(size: image.size))
                } else if self.retainedState.failedImageURL == mediaURL {
                    unavailableView(unavailableReason: .cacheOrDownloadUnavailable)
                } else {
                    imageLoadingView(aspectRatio: self.retainedState.placeholderAspectRatio ?? reviewManagedImagePlaceholderAspectRatio)
                }
            }
            .task(id: mediaURL) {
                self.retainedState.loadFileImage(mediaURL: mediaURL)
            }
        } else if let image = self.retainedState.remoteImage {
            reviewManagedImageView(image: image, accessibilityLabel: accessibilityLabel, aspectRatio: nil)
        } else if self.retainedState.remoteImageFailed {
            unavailableView(unavailableReason: .cacheOrDownloadUnavailable)
        } else {
            AsyncImage(url: mediaURL) { phase in
                Group {
                    switch phase {
                    case .empty: imageLoadingView(aspectRatio: reviewManagedImagePlaceholderAspectRatio)
                    case .success(let image):
                        reviewManagedImageView(image: image, accessibilityLabel: accessibilityLabel, aspectRatio: nil)
                    case .failure: unavailableView(unavailableReason: .cacheOrDownloadUnavailable)
                    @unknown default: unavailableView(unavailableReason: .cacheOrDownloadUnavailable)
                    }
                }
                .onChange(of: phase.image, initial: true) { _, image in
                    if let image { self.retainedState.retainRemoteImage(image, mediaURL: mediaURL) }
                }
                .onChange(of: phase.error != nil, initial: true) { _, failed in
                    if failed { self.retainedState.retainRemoteFailure(mediaURL: mediaURL) }
                }
            }
        }
    }

    /// An image without a description gets no label, so VoiceOver announces it as an image.
    @ViewBuilder
    private func reviewManagedImageView(
        image: Image,
        accessibilityLabel: String?,
        aspectRatio: CGFloat?
    ) -> some View {
        let presentedImage = Group {
            if let aspectRatio {
                image
                    .resizable()
                    .scaledToFit()
                    .aspectRatio(aspectRatio, contentMode: .fit)
            } else {
                image
                    .resizable()
                    .scaledToFit()
            }
        }
        .frame(maxWidth: reviewManagedImagePresentationMaxWidth)
        .clipShape(RoundedRectangle(cornerRadius: reviewManagedMediaCornerRadius))
        .frame(maxWidth: .infinity, alignment: .center)

        if let accessibilityLabel {
            presentedImage.accessibilityLabel(accessibilityLabel)
        } else {
            presentedImage
        }
    }

    private func unavailableView(unavailableReason: ReviewManagedMediaUnavailableReason?) -> some View {
        Label(unavailableLabel(unavailableReason: unavailableReason), systemImage: "exclamationmark.triangle")
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(mediaBackgroundStyle, in: RoundedRectangle(cornerRadius: reviewManagedMediaCornerRadius))
    }

    private var mediaBackgroundStyle: AnyShapeStyle {
        switch surfaceStyle {
        case .front:
            return AnyShapeStyle(Color.secondary.opacity(0.10))
        case .back:
            return AnyShapeStyle(Color.secondary.opacity(0.08))
        }
    }

    private func mediaDescription(mediaAsset: MediaAsset) -> String? {
        if let label = reference.label, label.isEmpty == false {
            return label
        }

        return mediaAsset.sourceUrl.flatMap(reviewManagedMediaFileName(sourceUrl:))
    }

    private func displayLabel(mediaAsset: MediaAsset, category: ReviewManagedMediaCategory) -> String {
        if let description = mediaDescription(mediaAsset: mediaAsset) {
            return description
        }

        switch category {
        case .image:
            return String(localized: "Managed image", table: reviewManagedMediaStringsTableName)
        case .audio:
            return String(localized: "Audio attachment", table: reviewManagedMediaStringsTableName)
        case .video:
            return String(localized: "Video attachment", table: reviewManagedMediaStringsTableName)
        case .attachment:
            return String(localized: "Attachment", table: reviewManagedMediaStringsTableName)
        }
    }

    private func unavailableLabel(unavailableReason: ReviewManagedMediaUnavailableReason?) -> String {
        switch unavailableReason {
        case .some(.missingRegistry):
            return String(localized: "Media still syncing", table: reviewManagedMediaStringsTableName)
        case .some(.cacheOrDownloadUnavailable), nil:
            return String(localized: "Media unavailable", table: reviewManagedMediaStringsTableName)
        }
    }
}

func reviewManagedImageAspectRatio(size: CGSize) -> CGFloat? {
    let width: CGFloat = size.width
    let height: CGFloat = size.height
    guard width.isFinite, height.isFinite, width > 0, height > 0 else {
        return nil
    }

    let aspectRatio: CGFloat = width / height
    guard aspectRatio.isFinite, aspectRatio > 0 else {
        return nil
    }

    return aspectRatio
}

/// Reads only the file header, so a placeholder takes the image's shape before the slower full decode.
func readReviewManagedImagePixelSize(mediaURL: URL) async -> CGSize? {
    await Task.detached(priority: .userInitiated) { () -> CGSize? in
        guard let imageSource = CGImageSourceCreateWithURL(mediaURL as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [String: Any],
              let pixelWidth = properties[kCGImagePropertyPixelWidth as String] as? Int,
              let pixelHeight = properties[kCGImagePropertyPixelHeight as String] as? Int else {
            return nil
        }

        // Match the decoded UIImage, whose size already applies the EXIF rotation.
        let orientation = (properties[kCGImagePropertyOrientation as String] as? UInt32)
            .flatMap(CGImagePropertyOrientation.init(rawValue:))
        switch orientation {
        case .left, .leftMirrored, .right, .rightMirrored:
            return CGSize(width: pixelHeight, height: pixelWidth)
        default:
            return CGSize(width: pixelWidth, height: pixelHeight)
        }
    }.value
}

func decodeReviewManagedFileImage(mediaURL: URL) async -> UIImage? {
    let decodeTask = Task.detached(priority: .userInitiated) { () -> UIImage? in
        guard Task.isCancelled == false else {
            return nil
        }

        var configuration = UIImageReader.Configuration()
        configuration.preparesImagesForDisplay = true
        let imageReader = UIImageReader(configuration: configuration)
        let image = await imageReader.image(contentsOf: mediaURL)
        guard Task.isCancelled == false else {
            return nil
        }

        return image
    }

    return await withTaskCancellationHandler {
        await decodeTask.value
    } onCancel: {
        decodeTask.cancel()
    }
}

private struct ReviewManagedMediaPlayer: UIViewControllerRepresentable {
    let player: AVPlayer?
    let delegate: ReviewManagedMediaFullScreenDelegate

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.delegate = self.delegate
        controller.player = self.player
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== self.player {
            controller.player = self.player
        }
    }
}

private func reviewManagedMediaFileName(sourceUrl: String) -> String? {
    guard let url = URL(string: sourceUrl) else {
        return nil
    }

    let lastPathComponent = url.lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
    guard lastPathComponent.isEmpty == false else {
        return nil
    }

    return lastPathComponent.removingPercentEncoding ?? lastPathComponent
}
