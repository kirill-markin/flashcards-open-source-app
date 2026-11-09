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
    @ObservationIgnored private var fileTask: Task<Void, Never>?

    deinit {
        self.loadTask?.cancel()
        self.fileTask?.cancel()
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

    /// The copy in full screen keeps the player even while AVKit has it out of the window.
    func setFullScreen(_ isFullScreen: Bool, id: UUID) {
        if isFullScreen {
            self.fullScreenPresentationID = id
        } else if self.fullScreenPresentationID == id {
            self.fullScreenPresentationID = nil
        }
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
            self.fileTask?.cancel()
            self.fileTask = nil
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

    func loadFileImage(mediaURL: URL) {
        guard self.decodedImageURL != mediaURL, self.failedImageURL != mediaURL, self.fileTask == nil else { return }
        self.fileTask = Task { [weak self] in
            let pixelSize = await readReviewManagedImagePixelSize(mediaURL: mediaURL)
            guard Task.isCancelled == false, self?.loadResult?.mediaURL == mediaURL else { return }
            self?.placeholderAspectRatio = pixelSize.flatMap(reviewManagedImageAspectRatio(size:))
            let image = await decodeReviewManagedFileImage(mediaURL: mediaURL)
            guard let self, Task.isCancelled == false, self.loadResult?.mediaURL == mediaURL else { return }
            if let image {
                self.decodedImage = image
                self.decodedImageURL = mediaURL
                self.failedImageURL = nil
            } else {
                self.decodedImage = nil
                self.decodedImageURL = nil
                self.failedImageURL = mediaURL
            }
            self.fileTask = nil
        }
    }

    private func resetResolvedMedia() {
        self.fileTask?.cancel()
        self.fileTask = nil
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
            // Cache files have no extension, so AVFoundation needs the MIME type to open them.
            if self.player == nil {
                self.player = AVPlayer(playerItem: AVPlayerItem(asset: AVURLAsset(url: url, options: [AVURLAssetOverrideMIMETypeKey: mimeType])))
            }
        } else {
            self.player?.pause()
            self.player = nil
        }
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
