import SwiftUI


extension View {
    /// Keeps mobile navigation titles and emits specific Mac destination metadata.
    func nativeNavigationTitle(_ title: String) -> some View {
        #if targetEnvironment(macCatalyst)
        self.navigationTitle("")
            .toolbar(.hidden, for: .navigationBar)
            .background { MacNavigationHeaderEmitter(title: title) }
        #else
        self.navigationTitle(title)
        #endif
    }
}

#if targetEnvironment(macCatalyst)
struct MacToolbarBackdropContext: Equatable {
    let selectedTab: AppTab
    let companionVisible: Bool
    let aiDepth: Int
    let settingsDepth: Int
}

/// One system bar material for the entire split detail, including its chat. Catalyst's
/// automatic scroll edge effects are confined to individual scroll views.
@available(iOS 26.0, *)
struct MacSharedToolbarBackdrop: UIViewRepresentable {
    let contextID: MacToolbarBackdropContext

    func makeUIView(context: Context) -> BackdropView { BackdropView() }
    func updateUIView(_ view: BackdropView, context: Context) {
        if view.contextID != self.contextID {
            view.contextID = self.contextID
            view.invalidateScrollViews()
            // UIKit installs the selected tab's view after SwiftUI publishes its state.
            DispatchQueue.main.async { [weak view] in
                view?.invalidateScrollViews()
                view?.setNeedsLayout()
            }
        }
        view.setNeedsLayout()
    }
    static func dismantleUIView(_ view: BackdropView, coordinator: ()) { view.detach() }

    final class BackdropView: UIView {
        var contextID: MacToolbarBackdropContext?
        private let material = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))
        private var geometryMarker: UILabel?
        private var observations: [NSKeyValueObservation] = []
        private var scrollViews: [UIScrollView] = []
        private var searchedFrame: CGRect?

        override init(frame: CGRect) {
            super.init(frame: frame)
            self.isUserInteractionEnabled = false
            self.material.isUserInteractionEnabled = false
            self.material.accessibilityElementsHidden = true
            self.material.isHidden = true
            self.addSubview(self.material)
            if AutomationRun.current.isUITestLaunch {
                // AppKit clips UIKit's AX tree below the toolbar. Expose the actual
                // material geometry from the content area for native smoke checks.
                let marker = UILabel()
                marker.text = "Toolbar background geometry"
                marker.textColor = .clear
                marker.font = .systemFont(ofSize: 1)
                marker.accessibilityIdentifier = "mac.toolbar.backdrop.geometry"
                self.addSubview(marker)
                self.geometryMarker = marker
            }
        }

        required init?(coder: NSCoder) {
            fatalError("BackdropView is created in code")
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            if self.window == nil { self.detach() } else { self.setNeedsLayout() }
        }

        override func safeAreaInsetsDidChange() {
            super.safeAreaInsetsDidChange()
            self.setNeedsLayout()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            guard let window = self.window else { return self.detach() }
            let frame = self.convert(self.bounds, to: window)
            if self.searchedFrame != frame || self.scrollViews.isEmpty {
                self.searchedFrame = frame
                self.observeScrollViews(in: window, detailFrame: frame)
            }
            self.updatePresentation()
        }

        private func updatePresentation() {
            guard let window = self.window else { return }
            let frame = self.convert(self.bounds, to: window)
            // Catalyst applies the titlebar inset to its content scroll views, not
            // necessarily UIWindow. Convert their actual content edges to this overlay.
            let contentTop = self.scrollViews.compactMap { scroll -> CGFloat? in
                guard let parent = scroll.superview else { return nil }
                return parent.convert(scroll.frame, to: window).minY + scroll.adjustedContentInset.top
            }.max() ?? 0
            self.material.frame = self.convert(CGRect(x: frame.minX, y: 0, width: frame.width,
                height: max(0, contentTop)), from: window)
            self.updateVisibility()
            if let marker = self.geometryMarker {
                marker.frame = CGRect(x: 0, y: max(0, min(self.bounds.height - 1, contentTop)), width: 1, height: 1)
                let measured = self.material.convert(self.material.bounds, to: window)
                marker.accessibilityValue = "x=\(measured.minX);width=\(measured.width);height=\(measured.height);windowWidth=\(window.bounds.width);visible=\(self.material.isHidden ? 0 : 1)"
            }
        }

        func invalidateScrollViews() {
            self.observations.removeAll()
            self.scrollViews.removeAll()
            self.searchedFrame = nil
        }

        func detach() {
            self.invalidateScrollViews()
            self.material.isHidden = true
        }

        private func observeScrollViews(in window: UIWindow, detailFrame: CGRect) {
            self.observations.removeAll()
            self.scrollViews.removeAll()
            func search(_ view: UIView) {
                guard view !== self, !view.isHidden, view.alpha > 0 else { return }
                if let scroll = view as? UIScrollView, !(scroll is UITextView), let parent = scroll.superview {
                    let frame = parent.convert(scroll.frame, to: window)
                    // Full-height content under this toolbar only: exclude horizontal
                    // suggestions, composer editors, sheets and popovers.
                    if frame.intersection(detailFrame).width > 150, frame.height > 150,
                       frame.minY <= self.convert(self.safeAreaLayoutGuide.layoutFrame, to: window).minY + 1,
                       frame.maxY > detailFrame.minY + 150 {
                        self.scrollViews.append(scroll)
                    }
                }
                for subview in view.subviews { search(subview) }
            }
            if let root = window.rootViewController?.viewIfLoaded { search(root) }
            for scroll in self.scrollViews {
                self.observations.append(scroll.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
                    MainActor.assumeIsolated { self?.updatePresentation() }
                })
                self.observations.append(scroll.observe(\.contentSize, options: [.new]) { [weak self] _, _ in
                    MainActor.assumeIsolated { self?.updatePresentation() }
                })
                self.observations.append(scroll.observe(\.adjustedContentInset, options: [.new]) { [weak self] _, _ in
                    MainActor.assumeIsolated { self?.updatePresentation() }
                })
            }
        }

        private func updateVisibility() {
            self.material.isHidden = !self.scrollViews.contains { scroll in
                guard scroll.window === self.window else { return false }
                var ancestor: UIView? = scroll
                while let view = ancestor {
                    if view.isHidden || view.alpha == 0 { return false }
                    ancestor = view.superview
                }
                return scroll.contentOffset.y + scroll.adjustedContentInset.top > 0.5
            }
        }
    }
}
#endif
