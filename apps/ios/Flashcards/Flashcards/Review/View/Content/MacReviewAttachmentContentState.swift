#if targetEnvironment(macCatalyst)
import NetworkImage
import Observation
import SwiftUI

@MainActor
@Observable
final class MacReviewFormulaState {
    var renderFailed = false
    var scrollPosition = ScrollPosition(edge: .leading)
}

@MainActor
@Observable
final class MacReviewImageState {
    var image: NetworkImageState = .empty
    private let url: URL
    @ObservationIgnored private var task: Task<Void, Never>?

    init(url: URL) {
        self.url = url
    }

    deinit { self.task?.cancel() }

    func load() {
        guard self.task == nil else { return }
        let url = self.url
        self.task = Task { [weak self] in
            do {
                let image = try await DefaultNetworkImageLoader.shared.image(from: url)
                guard Task.isCancelled == false else { return }
                self?.image = .success(
                    image: Image(decorative: image, scale: 1),
                    idealSize: CGSize(width: CGFloat(image.width), height: CGFloat(image.height))
                )
            } catch {
                guard Task.isCancelled == false else { return }
                self?.image = .failure
            }
        }
    }
}

struct MacReviewImageView: View {
    let state: MacReviewImageState

    var body: some View {
        Group {
            switch self.state.image {
            case .empty, .failure:
                Color.clear.frame(width: 0, height: 0)
            case .success(let image, let idealSize):
                MacReviewImageLayout(idealSize: idealSize) { image.resizable() }
            }
        }
        .task { self.state.load() }
    }
}

private struct MacReviewImageLayout: Layout {
    let idealSize: CGSize

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let width = proposal.width, width < self.idealSize.width else { return self.idealSize }
        return CGSize(width: width, height: width * self.idealSize.height / self.idealSize.width)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: .init(bounds.size))
    }
}
#endif
