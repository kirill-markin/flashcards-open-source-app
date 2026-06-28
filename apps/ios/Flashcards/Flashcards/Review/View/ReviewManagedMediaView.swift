import AVKit
import SwiftUI

private let reviewManagedMediaStringsTableName: String = "ReviewCards"
private let reviewManagedMediaCornerRadius: CGFloat = 12
private let reviewManagedImageMaxHeight: CGFloat = 320
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
    let localReadVersion: Int

    init(mediaAssetId: String, workspaceId: String?, localReadVersion: Int) {
        self.mediaAssetId = mediaAssetId
        self.workspaceId = workspaceId
        self.localReadVersion = localReadVersion
    }
}

struct ReviewManagedMediaView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    let reference: ReviewManagedMediaReference
    let surfaceStyle: ReviewCardSurfaceStyle

    @State private var loadResult: ReviewManagedMediaLoadResult?
    @State private var isLoading: Bool = true

    var body: some View {
        Group {
            if isLoading {
                loadingView
            } else if let loadResult,
                      let mediaAsset = loadResult.mediaAsset,
                      let downloadURL = loadResult.downloadURL {
                readyView(mediaAsset: mediaAsset, downloadURL: downloadURL)
            } else {
                unavailableView(mediaAsset: loadResult?.mediaAsset)
            }
        }
        .task(id: taskID) { [taskID] in
            await self.loadManagedMedia(taskID: taskID)
        }
    }

    private var taskID: ReviewManagedMediaTaskID {
        ReviewManagedMediaTaskID(
            mediaAssetId: reference.mediaAssetId,
            workspaceId: store.workspace?.workspaceId,
            localReadVersion: store.localReadVersion
        )
    }

    private var loadingView: some View {
        HStack(spacing: 10) {
            ProgressView()
                .controlSize(.small)
            Text(String(localized: "Loading media...", table: reviewManagedMediaStringsTableName))
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(mediaBackgroundStyle, in: RoundedRectangle(cornerRadius: reviewManagedMediaCornerRadius))
    }

    private func readyView(mediaAsset: MediaAsset, downloadURL: URL) -> some View {
        let category = ReviewManagedMediaCategory(
            mimeType: mediaAsset.mimeType,
            isImageSyntax: reference.isImageSyntax
        )

        return Group {
            switch category {
            case .image:
                AsyncImage(url: downloadURL) { phase in
                    switch phase {
                    case .empty:
                        loadingView
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: .infinity, maxHeight: reviewManagedImageMaxHeight, alignment: .center)
                            .clipShape(RoundedRectangle(cornerRadius: reviewManagedMediaCornerRadius))
                            .accessibilityLabel(displayLabel(mediaAsset: mediaAsset, category: .image))
                    case .failure:
                        unavailableView(mediaAsset: mediaAsset)
                    @unknown default:
                        unavailableView(mediaAsset: mediaAsset)
                    }
                }
            case .audio:
                ReviewManagedMediaPlayerView(url: downloadURL, height: reviewManagedAudioHeight)
                    .accessibilityLabel(displayLabel(mediaAsset: mediaAsset, category: .audio))
            case .video:
                ReviewManagedMediaPlayerView(url: downloadURL, height: reviewManagedVideoMinHeight)
                    .accessibilityLabel(displayLabel(mediaAsset: mediaAsset, category: .video))
            case .attachment:
                Link(destination: downloadURL) {
                    Label(displayLabel(mediaAsset: mediaAsset, category: .attachment), systemImage: "paperclip")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                }
                .background(mediaBackgroundStyle, in: RoundedRectangle(cornerRadius: reviewManagedMediaCornerRadius))
            }
        }
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

    private func loadManagedMedia(taskID: ReviewManagedMediaTaskID) async {
        guard taskID == self.taskID else {
            return
        }

        self.isLoading = true
        let nextLoadResult = await store.loadReviewManagedMedia(mediaAssetId: taskID.mediaAssetId)
        guard Task.isCancelled == false, taskID == self.taskID else {
            return
        }

        self.loadResult = nextLoadResult
        self.isLoading = false
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
