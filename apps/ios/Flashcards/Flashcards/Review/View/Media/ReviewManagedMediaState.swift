import AVKit
import Observation
import SwiftUI
import UIKit

@MainActor
@Observable
final class ReviewManagedMediaState {
    private(set) var loadResult: ReviewManagedMediaLoadResult?
    private(set) var isLoading = true
    private(set) var decodedImage: UIImage?
    private(set) var decodedImageURL: URL?
    private(set) var failedImageURL: URL?
    private(set) var placeholderAspectRatio: CGFloat?
    private(set) var remoteImage: Image?
    private(set) var remoteImageFailed = false
    private(set) var player: AVPlayer?
    private(set) var activePresentationID: UUID?
    @ObservationIgnored private var presentations: [UUID] = []
    @ObservationIgnored private var fullScreenPresentationID: UUID?
    @ObservationIgnored private var request: ReviewManagedMediaTaskID?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    let fullScreenDelegate = ReviewManagedMediaFullScreenDelegate()

    init() {
        self.fullScreenDelegate.state = self
    }

    deinit {
        self.loadTask?.cancel()
    }

    func setPresented(_ isPresented: Bool, id: UUID, store: FlashcardsStore) {
        self.presentations.removeAll { $0 == id }
        if isPresented { self.presentations.append(id) }
        self.activePresentationID = self.fullScreenPresentationID ?? self.presentations.last
        // A successor graph can start its load before the deferred teardown below cancels it; resume that load.
        if isPresented, self.isLoading, self.loadTask == nil, let request = self.request {
            self.load(request: request, store: store)
        }
        self.scheduleTeardownIfUnclaimed()
    }

    /// Only the active copy holds the player, so it is the one AVKit shows full screen; it keeps the
    /// player until full screen ends, even if TextKit replaces it meanwhile.
    fileprivate func setFullScreen(_ isFullScreen: Bool) {
        self.fullScreenPresentationID = isFullScreen ? self.activePresentationID : nil
        self.activePresentationID = self.fullScreenPresentationID ?? self.presentations.last
        self.scheduleTeardownIfUnclaimed()
    }

    private var isClaimed: Bool {
        self.presentations.isEmpty == false || self.fullScreenPresentationID != nil
    }

    private func scheduleTeardownIfUnclaimed() {
        guard self.isClaimed == false else { return }
        // TextKit replacement can remove a graph before inserting its successor in the same layout turn.
        DispatchQueue.main.async { [weak self] in
            guard let self, self.isClaimed == false else { return }
            self.generation = UUID()
            self.loadTask?.cancel()
            self.loadTask = nil
            self.player?.pause()
        }
    }

    func load(request: ReviewManagedMediaTaskID, store: FlashcardsStore) {
        // Available media never reloads for the same request; unavailable media retries on each call.
        if self.request == request,
           self.loadTask != nil || self.loadResult?.mediaURL != nil { return }
        self.loadTask?.cancel()
        if self.request != request {
            self.loadResult = nil
            self.isLoading = true
            self.resetResolvedMedia()
        }
        self.request = request
        guard request.state == .ready else { return }
        let generation = UUID()
        self.generation = generation
        self.loadTask = Task { [weak self] in
            while Task.isCancelled == false {
                let version = store.localReadVersion
                let result = await store.loadReviewManagedMedia(mediaAssetId: request.mediaAssetId)
                guard let self, Task.isCancelled == false, self.generation == generation,
                      store.workspace?.workspaceId == request.workspaceId else { return }
                guard version == store.localReadVersion else { continue }
                if self.loadResult?.mediaURL != result.mediaURL { self.resetResolvedMedia() }
                self.loadResult = result
                self.isLoading = false
                self.preparePlayer(result: result)
                self.loadTask = nil
                return
            }
        }
    }

    func retainRemoteImage(_ image: Image, mediaURL: URL) {
        guard self.loadResult?.mediaURL == mediaURL else { return }
        self.remoteImage = image
    }

    func retainRemoteFailure(mediaURL: URL) {
        guard self.loadResult?.mediaURL == mediaURL else { return }
        self.remoteImageFailed = true
    }

    /// Runs in the showing view's `task(id:)`, so the decode lives exactly as long as a view displays this URL.
    func loadFileImage(mediaURL: URL) async {
        guard self.decodedImageURL != mediaURL, self.failedImageURL != mediaURL else { return }
        let pixelSize = await readReviewManagedImagePixelSize(mediaURL: mediaURL)
        guard Task.isCancelled == false, self.loadResult?.mediaURL == mediaURL else { return }
        self.placeholderAspectRatio = pixelSize.flatMap(reviewManagedImageAspectRatio(size:))
        let image = await decodeReviewManagedFileImage(mediaURL: mediaURL)
        guard Task.isCancelled == false, self.loadResult?.mediaURL == mediaURL else { return }
        if let image {
            self.decodedImage = image
            self.decodedImageURL = mediaURL
            self.failedImageURL = nil
        } else {
            self.decodedImage = nil
            self.decodedImageURL = nil
            self.failedImageURL = mediaURL
        }
    }

    private func resetResolvedMedia() {
        self.decodedImage = nil
        self.decodedImageURL = nil
        self.failedImageURL = nil
        self.placeholderAspectRatio = nil
        self.remoteImage = nil
        self.remoteImageFailed = false
        self.player?.pause()
        self.player = nil
    }

    private func preparePlayer(result: ReviewManagedMediaLoadResult) {
        let mimeType = result.mediaAsset?.mimeType.lowercased() ?? ""
        if let url = result.mediaURL, mimeType.hasPrefix("audio/") || mimeType.hasPrefix("video/") {
            if self.player == nil {
                // Cache files have no extension, so AVFoundation needs the MIME type to open them.
                let options: [String: Any] = url.isFileURL ? [AVURLAssetOverrideMIMETypeKey: mimeType] : [:]
                self.player = AVPlayer(playerItem: AVPlayerItem(asset: AVURLAsset(url: url, options: options)))
            }
        } else {
            self.player?.pause()
            self.player = nil
        }
    }
}

/// Owned by the media state rather than a copy's coordinator: AVKit holds its delegate weakly, and a copy
/// TextKit tears down during full screen must not end the claim before the transition does.
@MainActor
final class ReviewManagedMediaFullScreenDelegate: NSObject, @preconcurrency AVPlayerViewControllerDelegate {
    fileprivate weak var state: ReviewManagedMediaState?

    func playerViewController(
        _ playerViewController: AVPlayerViewController,
        willBeginFullScreenPresentationWithAnimationCoordinator coordinator: UIViewControllerTransitionCoordinator
    ) {
        self.state?.setFullScreen(true)
        coordinator.animate(alongsideTransition: nil) { context in
            if context.isCancelled { self.reportFullScreenEnd() }
        }
    }

    func playerViewController(
        _ playerViewController: AVPlayerViewController,
        willEndFullScreenPresentationWithAnimationCoordinator coordinator: UIViewControllerTransitionCoordinator
    ) {
        coordinator.animate(alongsideTransition: nil) { context in
            if context.isCancelled == false { self.reportFullScreenEnd() }
        }
    }

    /// Reported on the next turn, like `ReviewMediaPresentation` reports removals, so the copy shown
    /// after full screen is registered before the claim moves off the one that was full screen.
    private func reportFullScreenEnd() {
        DispatchQueue.main.async { [weak state = self.state] in state?.setFullScreen(false) }
    }
}

struct ReviewMediaPresentation: UIViewRepresentable {
    let onChange: (UUID, Bool) -> Void

    func makeUIView(context: Context) -> ReviewMediaPresentationView {
        ReviewMediaPresentationView(onChange: self.onChange)
    }

    func updateUIView(_ view: ReviewMediaPresentationView, context: Context) {
        view.onChange = self.onChange
    }

    static func dismantleUIView(_ view: ReviewMediaPresentationView, coordinator: Void) {
        let id = view.presentationID
        let onChange = view.onChange
        DispatchQueue.main.async { onChange(id, false) }
    }
}

final class ReviewMediaPresentationView: UIView {
    let presentationID = UUID()
    var onChange: (UUID, Bool) -> Void

    init(onChange: @escaping (UUID, Bool) -> Void) {
        self.onChange = onChange
        super.init(frame: .zero)
        self.isUserInteractionEnabled = false
    }

    required init?(coder: NSCoder) { nil }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        let id = self.presentationID
        let isPresented = self.window != nil
        let onChange = self.onChange
        DispatchQueue.main.async { onChange(id, isPresented) }
    }
}
