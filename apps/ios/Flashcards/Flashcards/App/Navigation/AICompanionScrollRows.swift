import SwiftUI
import UIKit

@MainActor
final class AIChatScrollRowLayout {
    struct VisibleRow {
        let id: String
        let height: CGFloat
        let topOffset: CGFloat
    }

    // A List row has no scroll view coordinate space, so measure both frames and viewport in window space.
    private var rowFrames: [String: CGRect] = [:]
    private var viewportTop: CGFloat = 0
    private var placedRestoreRowID: String? = nil

    func firstVisibleRow() -> VisibleRow? {
        let top = self.viewportTop
        guard let row = self.rowFrames
            .filter({ _, frame in frame.maxY > top && frame.height > 0 })
            .min(by: { $0.value.minY < $1.value.minY }) else { return nil }

        return VisibleRow(id: row.key, height: row.value.height, topOffset: top - row.value.minY)
    }

    func resetRestorePlacement() {
        self.placedRestoreRowID = nil
    }

    func hasPlacedRestoreRow(_ rowID: String) -> Bool {
        self.placedRestoreRowID == rowID
    }

    fileprivate func updateViewportTop(_ top: CGFloat) {
        self.viewportTop = top
    }

    fileprivate func setFrame(_ frame: CGRect?, for rowID: String) {
        self.rowFrames[rowID] = frame
    }

    fileprivate func markRestoreRowPlaced(_ rowID: String) {
        self.placedRestoreRowID = rowID
    }

    fileprivate func restoreDistance(rowTop: CGFloat, topOffset: CGFloat) -> CGFloat {
        rowTop - (self.viewportTop - topOffset)
    }
}

extension View {
    @MainActor
    func aiChatScrollViewport(layout: AIChatScrollRowLayout) -> some View {
        self.onGeometryChange(for: CGFloat.self) { geometry in
            geometry.frame(in: .global).minY
        } action: { top in
            layout.updateViewportTop(top)
        }
    }
}

enum AIChatScrollOffset: Equatable {
    case points(CGFloat)
    case rowFraction(CGFloat)
}

struct AIChatScrollRowFrameTracking: ViewModifier {
    let rowID: String
    let layout: AIChatScrollRowLayout?
    let restoredOffset: AIChatScrollOffset?
    let canRestore: @MainActor () -> Bool

    func body(content: Content) -> some View {
        if let layout = self.layout {
            content
                .onGeometryChange(for: CGRect.self) { geometry in
                    geometry.frame(in: .global)
                } action: { frame in
                    layout.setFrame(frame, for: self.rowID)
                }
                .onDisappear {
                    layout.setFrame(nil, for: self.rowID)
                }
                .background {
                    if let restoredOffset = self.restoredOffset {
                        AIChatScrollRowOffsetRestorer(
                            layout: layout,
                            rowID: self.rowID,
                            offset: restoredOffset,
                            canRestore: self.canRestore
                        )
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
        } else {
            content
        }
    }
}

/// Place the row before the first frame and retry as the list grows, because its initial content size can clamp
/// the offset short.
private struct AIChatScrollRowOffsetRestorer: UIViewRepresentable {
    let layout: AIChatScrollRowLayout
    let rowID: String
    let offset: AIChatScrollOffset
    let canRestore: @MainActor () -> Bool

    func makeUIView(context: Context) -> RestorerView {
        RestorerView()
    }

    func updateUIView(_ view: RestorerView, context: Context) {
        view.layout = self.layout
        view.rowID = self.rowID
        view.offset = self.offset
        view.canRestore = self.canRestore
        view.restoreNowAndAfterLayout()
    }

    final class RestorerView: UIView {
        weak var layout: AIChatScrollRowLayout?
        var rowID: String = ""
        var offset: AIChatScrollOffset = .points(0)
        var canRestore: @MainActor () -> Bool = { false }
        private weak var observedScrollView: UIScrollView?
        private var contentSizeObservation: NSKeyValueObservation?
        private var isCancelled: Bool = false

        override func didMoveToWindow() {
            super.didMoveToWindow()
            if self.window == nil {
                self.stopObserving()
            } else {
                self.restoreNowAndAfterLayout()
            }
        }

        func restoreNowAndAfterLayout() {
            self.restore()
            DispatchQueue.main.async { [weak self] in
                self?.restore()
            }
        }

        private func restore() {
            guard self.canRestore() else {
                self.stopObserving()
                return
            }
            guard self.isCancelled == false, self.window != nil, let layout = self.layout else { return }
            var ancestor = self.superview
            while let view = ancestor, (view is UIScrollView) == false {
                ancestor = view.superview
            }
            guard let scrollView = ancestor as? UIScrollView else { return }
            if scrollView.isTracking || scrollView.isDragging || scrollView.isDecelerating {
                self.isCancelled = true
                self.stopObserving()
                return
            }
            self.observe(scrollView)
            let topOffset: CGFloat
            switch self.offset {
            case .points(let points):
                topOffset = points
            case .rowFraction(let fraction):
                guard self.bounds.height > 0 else { return }
                topOffset = self.bounds.height * fraction
            }
            layout.markRestoreRowPlaced(self.rowID)
            let distance = layout.restoreDistance(rowTop: self.convert(self.bounds, to: nil).minY, topOffset: topOffset)
            guard abs(distance) >= 0.5 else { return }
            let minimumOffset = -scrollView.adjustedContentInset.top
            let maximumOffset = max(
                minimumOffset,
                scrollView.contentSize.height + scrollView.adjustedContentInset.bottom - scrollView.bounds.height
            )
            let offset = min(max(scrollView.contentOffset.y + distance, minimumOffset), maximumOffset)
            guard self.canRestore() else { return }
            scrollView.setContentOffset(CGPoint(x: scrollView.contentOffset.x, y: offset), animated: false)
        }

        private func observe(_ scrollView: UIScrollView) {
            guard self.observedScrollView !== scrollView else { return }
            self.stopObserving()
            self.observedScrollView = scrollView
            self.contentSizeObservation = scrollView.observe(\.contentSize, options: [.new]) { [weak self] _, _ in
                MainActor.assumeIsolated {
                    self?.restore()
                }
            }
        }

        private func stopObserving() {
            self.contentSizeObservation?.invalidate()
            self.contentSizeObservation = nil
            self.observedScrollView = nil
        }
    }
}
