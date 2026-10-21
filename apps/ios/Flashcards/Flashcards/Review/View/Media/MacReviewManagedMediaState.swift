#if targetEnvironment(macCatalyst)
import AVKit
import Observation
import SwiftUI
import UIKit

@MainActor
@Observable
final class MacReviewManagedMediaState {
    private(set) var loadResult: ReviewManagedMediaLoadResult?
    private(set) var isLoading = true
    private(set) var decodedImage: UIImage?
    private(set) var decodedImageURL: URL?
    private(set) var failedImageURL: URL?
    private(set) var remoteImage: Image?
    private(set) var remoteImageFailed = false
    private(set) var player: AVPlayer?
    private(set) var activePresentationID: UUID?
    @ObservationIgnored private var presentations: [UUID] = []
    @ObservationIgnored private var request: ReviewManagedMediaTaskID?
    @ObservationIgnored private var loadedVersion: Int?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var fileTask: Task<Void, Never>?

    deinit {
        self.loadTask?.cancel()
        self.fileTask?.cancel()
    }

    func setPresented(_ isPresented: Bool, id: UUID) {
        self.presentations.removeAll { $0 == id }
        if isPresented { self.presentations.append(id) }
        self.activePresentationID = self.presentations.last
        guard self.presentations.isEmpty else { return }
        // TextKit replacement can remove a graph before inserting its successor in the same layout turn.
        DispatchQueue.main.async { [weak self] in
            guard let self, self.presentations.isEmpty else { return }
            self.generation = UUID()
            self.loadTask?.cancel()
            self.loadTask = nil
            self.fileTask?.cancel()
            self.fileTask = nil
            self.player?.pause()
        }
    }

    func load(request: ReviewManagedMediaTaskID, store: FlashcardsStore) {
        if self.request == request,
           self.loadTask != nil || self.loadedVersion == store.localReadVersion { return }
        self.loadTask?.cancel()
        if self.request != request {
            self.loadResult = nil
            self.isLoading = true
            self.loadedVersion = nil
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
                self.loadedVersion = version
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

    func loadFileImage(mediaURL: URL, decode: @escaping @Sendable (URL) async -> UIImage?) {
        guard self.decodedImageURL != mediaURL, self.failedImageURL != mediaURL, self.fileTask == nil else { return }
        self.fileTask = Task { [weak self] in
            let image = await decode(mediaURL)
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
        self.remoteImage = nil
        self.remoteImageFailed = false
        self.player?.pause()
        self.player = nil
    }

    private func preparePlayer(result: ReviewManagedMediaLoadResult) {
        let mimeType = result.mediaAsset?.mimeType.lowercased() ?? ""
        if let url = result.mediaURL, mimeType.hasPrefix("audio/") || mimeType.hasPrefix("video/") {
            if self.player == nil { self.player = AVPlayer(url: url) }
        } else {
            self.player?.pause()
            self.player = nil
        }
    }
}

struct MacReviewMediaPresentation: UIViewRepresentable {
    let onChange: (UUID, Bool) -> Void

    func makeUIView(context: Context) -> MacReviewMediaPresentationView {
        MacReviewMediaPresentationView(onChange: self.onChange)
    }

    func updateUIView(_ view: MacReviewMediaPresentationView, context: Context) {
        view.onChange = self.onChange
    }

    static func dismantleUIView(_ view: MacReviewMediaPresentationView, coordinator: Void) {
        let id = view.presentationID
        let onChange = view.onChange
        DispatchQueue.main.async { onChange(id, false) }
    }
}

final class MacReviewMediaPresentationView: UIView {
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
#endif
