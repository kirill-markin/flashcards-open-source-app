import AVKit
import SwiftUI
import UIKit

private let reviewManagedMediaStringsTableName: String = "ReviewCards"
private let reviewManagedMediaCornerRadius: CGFloat = reviewContentSurfaceCornerRadius / 2
private let reviewManagedImagePlaceholderAspectRatio: CGFloat = 4.0 / 3.0
private let reviewManagedAudioHeight: CGFloat = 76
private let reviewManagedVideoMinHeight: CGFloat = 190

private enum ReviewManagedMediaCategory {
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

private struct ReviewManagedMediaTaskID: Hashable {
    let mediaAssetId: String
    let workspaceId: String?

    init(mediaAssetId: String, workspaceId: String?) {
        self.mediaAssetId = mediaAssetId
        self.workspaceId = workspaceId
    }
}

struct ReviewManagedMediaView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    let reference: ReviewManagedMediaReference
    let surfaceStyle: ReviewCardSurfaceStyle

    @State private var loadResult: ReviewManagedMediaLoadResult?
    @State private var isLoading: Bool = true
    @State private var localRefreshTask: Task<Void, Never>?

    var body: some View {
        Group {
            if isLoading {
                initialLoadingView
            } else if let loadResult,
                      let mediaAsset = loadResult.mediaAsset,
                      let mediaURL = loadResult.mediaURL {
                readyView(mediaAsset: mediaAsset, mediaURL: mediaURL)
            } else {
                unavailableView(mediaAsset: loadResult?.mediaAsset)
            }
        }
        .task(id: taskID) { [taskID] in
            self.localRefreshTask?.cancel()
            await self.loadManagedMedia(taskID: taskID, showsLoadingIndicator: true)
        }
        .onChange(of: store.localReadVersion) { _, _ in
            self.startLocalRefresh(taskID: self.taskID)
        }
        .onDisappear {
            self.localRefreshTask?.cancel()
            self.localRefreshTask = nil
        }
    }

    private var taskID: ReviewManagedMediaTaskID {
        ReviewManagedMediaTaskID(
            mediaAssetId: reference.mediaAssetId,
            workspaceId: store.workspace?.workspaceId
        )
    }

    @ViewBuilder
    private var initialLoadingView: some View {
        if reference.isImageSyntax {
            imageLoadingView
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

    private var imageLoadingView: some View {
        RoundedRectangle(cornerRadius: reviewManagedMediaCornerRadius)
            .fill(mediaBackgroundStyle)
            .aspectRatio(reviewManagedImagePlaceholderAspectRatio, contentMode: .fit)
            .frame(maxWidth: .infinity, alignment: .center)
            .overlay {
                ProgressView(loadingMediaLabel)
                    .controlSize(.regular)
                    .labelsHidden()
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(loadingMediaLabel)
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
                ReviewManagedMediaPlayerView(url: mediaURL, height: reviewManagedAudioHeight)
                    .accessibilityLabel(displayLabel(mediaAsset: mediaAsset, category: .audio))
            case .video:
                ReviewManagedMediaPlayerView(url: mediaURL, height: reviewManagedVideoMinHeight)
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
        let accessibilityLabel = displayLabel(mediaAsset: mediaAsset, category: .image)

        if mediaURL.isFileURL {
            ReviewManagedFileImageView(mediaURL: mediaURL) { image in
                self.reviewManagedImageView(
                    image: Image(uiImage: image),
                    accessibilityLabel: accessibilityLabel,
                    aspectRatio: reviewManagedImageAspectRatio(size: image.size)
                )
            } loading: {
                imageLoadingView
            } failure: {
                unavailableView(mediaAsset: mediaAsset)
            }
        } else {
            AsyncImage(url: mediaURL) { phase in
                switch phase {
                case .empty:
                    imageLoadingView
                case .success(let image):
                    reviewManagedImageView(
                        image: image,
                        accessibilityLabel: accessibilityLabel,
                        aspectRatio: nil
                    )
                case .failure:
                    unavailableView(mediaAsset: mediaAsset)
                @unknown default:
                    unavailableView(mediaAsset: mediaAsset)
                }
            }
        }
    }

    @ViewBuilder
    private func reviewManagedImageView(
        image: Image,
        accessibilityLabel: String,
        aspectRatio: CGFloat?
    ) -> some View {
        Group {
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
        .frame(maxWidth: .infinity, alignment: .center)
        .clipShape(RoundedRectangle(cornerRadius: reviewManagedMediaCornerRadius))
        .accessibilityLabel(accessibilityLabel)
    }

    private func unavailableView(mediaAsset: MediaAsset?) -> some View {
        let category = ReviewManagedMediaCategory(
            mimeType: mediaAsset?.mimeType,
            isImageSyntax: reference.isImageSyntax
        )

        return Label(unavailableLabel(category: category), systemImage: "exclamationmark.triangle")
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

    private func startLocalRefresh(taskID: ReviewManagedMediaTaskID) {
        self.localRefreshTask?.cancel()
        self.localRefreshTask = Task { @MainActor in
            await self.loadManagedMedia(taskID: taskID, showsLoadingIndicator: false)
        }
    }

    private func loadManagedMedia(taskID: ReviewManagedMediaTaskID, showsLoadingIndicator: Bool) async {
        guard taskID == self.taskID else {
            return
        }

        if showsLoadingIndicator {
            self.isLoading = true
        }

        while true {
            let localReadVersion = store.localReadVersion
            let nextLoadResult = await store.loadReviewManagedMedia(mediaAssetId: taskID.mediaAssetId)
            guard Task.isCancelled == false, taskID == self.taskID else {
                return
            }
            guard localReadVersion == store.localReadVersion else {
                continue
            }

            self.loadResult = nextLoadResult
            self.isLoading = false
            return
        }
    }

    private func displayLabel(mediaAsset: MediaAsset, category: ReviewManagedMediaCategory) -> String {
        if let label = reference.label, label.isEmpty == false {
            return label
        }

        if let sourceUrl = mediaAsset.sourceUrl,
           let fileName = reviewManagedMediaFileName(sourceUrl: sourceUrl) {
            return fileName
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

    private func unavailableLabel(category: ReviewManagedMediaCategory) -> String {
        switch category {
        case .image, .audio, .video, .attachment:
            return String(localized: "Media unavailable", table: reviewManagedMediaStringsTableName)
        }
    }
}

private struct ReviewManagedFileImageView<Content: View, Loading: View, Failure: View>: View {
    let mediaURL: URL
    let content: (UIImage) -> Content
    let loading: () -> Loading
    let failure: () -> Failure

    @State private var decodedImage: UIImage?
    @State private var decodedImageURL: URL?
    @State private var failedImageURL: URL?

    init(
        mediaURL: URL,
        @ViewBuilder content: @escaping (UIImage) -> Content,
        @ViewBuilder loading: @escaping () -> Loading,
        @ViewBuilder failure: @escaping () -> Failure
    ) {
        self.mediaURL = mediaURL
        self.content = content
        self.loading = loading
        self.failure = failure
    }

    var body: some View {
        Group {
            if let decodedImage,
               self.decodedImageURL == self.mediaURL {
                self.content(decodedImage)
            } else if self.failedImageURL == self.mediaURL {
                self.failure()
            } else {
                self.loading()
            }
        }
        .task(id: self.mediaURL) { [mediaURL] in
            await self.loadImage(mediaURL: mediaURL)
        }
    }

    private func loadImage(mediaURL: URL) async {
        guard self.decodedImageURL != mediaURL else {
            return
        }

        self.failedImageURL = nil
        let nextImage = await decodeReviewManagedFileImage(mediaURL: mediaURL)
        guard Task.isCancelled == false else {
            return
        }

        guard let nextImage else {
            if self.decodedImageURL != mediaURL {
                self.decodedImage = nil
                self.decodedImageURL = nil
            }
            self.failedImageURL = mediaURL
            return
        }

        self.decodedImage = nextImage
        self.decodedImageURL = mediaURL
        self.failedImageURL = nil
    }
}

private func reviewManagedImageAspectRatio(size: CGSize) -> CGFloat? {
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

private func decodeReviewManagedFileImage(mediaURL: URL) async -> UIImage? {
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

private struct ReviewManagedMediaPlayerView: View {
    let url: URL
    let height: CGFloat

    @State private var player: AVPlayer

    init(url: URL, height: CGFloat) {
        self.url = url
        self.height = height
        self._player = State(initialValue: AVPlayer(url: url))
    }

    var body: some View {
        VideoPlayer(player: player)
            .frame(maxWidth: .infinity, minHeight: height)
            .clipShape(RoundedRectangle(cornerRadius: reviewManagedMediaCornerRadius))
            .onChange(of: url) { _, newURL in
                self.player.pause()
                self.player = AVPlayer(url: newURL)
            }
            .onDisappear {
                self.player.pause()
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
