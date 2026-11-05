import SwiftUI


extension View {
    /// Keeps mobile navigation titles and emits specific Mac destination metadata.
    func nativeNavigationTitle(_ title: String) -> some View {
        #if targetEnvironment(macCatalyst)
        self.modifier(MacNavigationTitle(title: title))
        #else
        self.navigationTitle(title)
        #endif
    }

    /// Apply to a modal sheet's `NavigationStack`: on Mac its screens keep the sheet's
    /// navigation bar, because the window toolbar cannot reach a sheet.
    func macModalSheetNavigation() -> some View {
        #if targetEnvironment(macCatalyst)
        self.environment(\.isInMacModalSheet, true)
        #else
        self
        #endif
    }

    /// On Mac, registers the enclosing scroll view with the shared toolbar backdrop.
    func macToolbarScrollSurface(_ name: String) -> some View {
        #if targetEnvironment(macCatalyst)
        self.background {
            MacToolbarScrollSurfaceMarker(name: name)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        #else
        self
        #endif
    }
}

#if targetEnvironment(macCatalyst)
extension EnvironmentValues {
    @Entry var isInMacModalSheet: Bool = false
}

private struct MacNavigationTitle: ViewModifier {
    @Environment(\.isInMacModalSheet) private var isInMacModalSheet
    let title: String

    func body(content: Content) -> some View {
        if self.isInMacModalSheet {
            content.navigationTitle(self.title)
        } else {
            content.navigationTitle("")
                .toolbar(.hidden, for: .navigationBar)
                .background { MacNavigationHeaderEmitter(title: self.title) }
        }
    }
}

struct MacToolbarBackdropContext: Equatable {
    let selectedTab: AppTab
    let companionVisible: Bool
    let aiDepth: Int
    let librarySection: LibrarySection?
    let libraryDepth: Int
    let settingsDepth: Int
}

/// Marks the scroll view enclosing this content as a page or companion surface for the
/// shared toolbar backdrop. Place it inside content whose scroll view SwiftUI may
/// recreate without navigation, such as a loader swap or the companion's transition.
struct MacToolbarScrollSurfaceMarker: UIViewRepresentable {
    let name: String

    func makeUIView(context: Context) -> MarkerView {
        let view = MarkerView()
        view.isUserInteractionEnabled = false
        view.isAccessibilityElement = false
        view.accessibilityElementsHidden = true
        view.name = self.name
        return view
    }
    func updateUIView(_ view: MarkerView, context: Context) { view.name = self.name }

    final class MarkerView: UIView {
        var name = ""
        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard self.window != nil else { return }
            var ancestor = self.superview
            while let view = ancestor {
                if let scroll = view as? UIScrollView, !(scroll is UITextView) {
                    MacToolbarScrollSurfaces.register(scroll, name: self.name)
                    return
                }
                ancestor = view.superview
            }
        }
    }
}

/// Registered surfaces, held weakly. Each registration is announced once.
@MainActor
enum MacToolbarScrollSurfaces {
    static let didRegister = Notification.Name("nibomo.macToolbarScrollSurfaceDidRegister")
    /// Posted by a page's toolbar emitters when they enter a window.
    static let pageDidAppear = Notification.Name("nibomo.macToolbarPageDidAppear")
    private static let names = NSMapTable<UIScrollView, NSString>.weakToStrongObjects()

    static func register(_ scroll: UIScrollView, name: String) {
        guard self.names.object(forKey: scroll) == nil else { return }
        self.names.setObject(name as NSString, forKey: scroll)
        NotificationCenter.default.post(name: self.didRegister, object: scroll)
    }

    static func name(of scroll: UIScrollView) -> String? { self.names.object(forKey: scroll) as String? }

    static func all(in window: UIWindow) -> [UIScrollView] {
        (self.names.keyEnumerator().allObjects as? [UIScrollView] ?? []).filter { $0.window === window }
    }
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
            // The detail installs the selected section's views after SwiftUI publishes its state.
            view.scheduleDiscovery()
        }
        view.setNeedsLayout()
    }
    static func dismantleUIView(_ view: BackdropView, coordinator: ()) { view.detach() }

    final class BackdropView: UIView {
        private final class Surface {
            weak var scroll: UIScrollView?
            let observations: [NSKeyValueObservation]
            init(scroll: UIScrollView, observations: [NSKeyValueObservation]) {
                self.scroll = scroll
                self.observations = observations
            }
        }

        var contextID: MacToolbarBackdropContext?
        private let material = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))
        private var geometryMarker: UILabel?
        private var surfaces: [ObjectIdentifier: Surface] = [:]
        private var isDiscoveryScheduled = false

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
            NotificationCenter.default.removeObserver(self)
            guard self.window != nil else { return self.detach() }
            NotificationCenter.default.addObserver(self, selector: #selector(self.surfaceDidRegister(_:)),
                name: MacToolbarScrollSurfaces.didRegister, object: nil)
            NotificationCenter.default.addObserver(self, selector: #selector(self.pageDidAppear(_:)),
                name: MacToolbarScrollSurfaces.pageDidAppear, object: nil)
            self.scheduleDiscovery()
        }

        override func safeAreaInsetsDidChange() {
            super.safeAreaInsetsDidChange()
            self.setNeedsLayout()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            self.updatePresentation()
        }

        @objc private func surfaceDidRegister(_ notification: Notification) {
            // Presented sheets and popovers sit outside the root view and keep their own edges.
            guard let scroll = notification.object as? UIScrollView, let window = self.window,
                  scroll.window === window, let root = window.rootViewController?.viewIfLoaded,
                  scroll.isDescendant(of: root) else { return }
            self.observe(scroll)
            self.updatePresentation()
        }

        @objc private func pageDidAppear(_ notification: Notification) {
            guard let view = notification.object as? UIView, view.window === self.window else { return }
            self.scheduleDiscovery()
        }

        /// One coalesced search after navigation, when the new page's views are installed.
        func scheduleDiscovery() {
            guard !self.isDiscoveryScheduled else { return }
            self.isDiscoveryScheduled = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.isDiscoveryScheduled = false
                self.discoverScrollViews()
                self.updatePresentation()
            }
        }

        /// Scroll views that currently cover this detail beneath the toolbar.
        private var visibleScrollViews: [UIScrollView] {
            guard let window = self.window, let root = window.rootViewController?.viewIfLoaded else { return [] }
            let detailFrame = self.convert(self.bounds, to: window)
            return self.surfaces.values.compactMap { surface in
                // Retained surfaces may since have moved out of the detail, e.g. a page
                // translated away by a transition or reparented into a presentation.
                guard let scroll = surface.scroll, scroll.window === window, scroll.isDescendant(of: root),
                      let parent = scroll.superview,
                      parent.convert(scroll.frame, to: window).intersects(detailFrame) else { return nil }
                var ancestor: UIView? = scroll
                while let view = ancestor {
                    if view.isHidden || view.alpha == 0 { return nil }
                    ancestor = view.superview
                }
                return scroll
            }
        }

        private func updatePresentation() {
            guard let window = self.window else { return }
            let frame = self.convert(self.bounds, to: window)
            let visible = self.visibleScrollViews
            // Catalyst applies the titlebar inset to its content scroll views, not
            // necessarily UIWindow. Convert their actual content edges to this overlay.
            let contentTop = visible.compactMap { scroll -> CGFloat? in
                guard let parent = scroll.superview else { return nil }
                return parent.convert(scroll.frame, to: window).minY + scroll.adjustedContentInset.top
            }.max() ?? 0
            self.material.frame = self.convert(CGRect(x: frame.minX, y: 0, width: frame.width,
                height: max(0, contentTop)), from: window)
            self.material.isHidden = !visible.contains { $0.contentOffset.y + $0.adjustedContentInset.top > 0.5 }
            if let marker = self.geometryMarker {
                marker.frame = CGRect(x: 0, y: max(0, min(self.bounds.height - 1, contentTop)), width: 1, height: 1)
                let measured = self.material.convert(self.material.bounds, to: window)
                let registered = Set(visible.compactMap(MacToolbarScrollSurfaces.name(of:))).sorted().joined(separator: ",")
                marker.accessibilityValue = "x=\(measured.minX);width=\(measured.width);height=\(measured.height);windowWidth=\(window.bounds.width);visible=\(self.material.isHidden ? 0 : 1);surfaces=\(visible.count);registered=\(registered)"
            }
        }

        func detach() {
            NotificationCenter.default.removeObserver(self)
            self.surfaces.removeAll()
            self.material.isHidden = true
        }

        private func observe(_ scroll: UIScrollView) {
            let key = ObjectIdentifier(scroll)
            if self.surfaces[key]?.scroll === scroll { return }
            self.surfaces[key] = Surface(scroll: scroll, observations: [
                scroll.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
                    MainActor.assumeIsolated { self?.updatePresentation() }
                },
                scroll.observe(\.contentSize, options: [.new]) { [weak self] _, _ in
                    MainActor.assumeIsolated { self?.updatePresentation() }
                },
                scroll.observe(\.adjustedContentInset, options: [.new]) { [weak self] _, _ in
                    MainActor.assumeIsolated { self?.updatePresentation() }
                },
            ])
        }

        private func discoverScrollViews() {
            guard let window = self.window, let root = window.rootViewController?.viewIfLoaded else { return }
            // Drop released surfaces; ones outside the window stay observed for their return.
            self.surfaces = self.surfaces.filter { $0.value.scroll != nil }
            for scroll in MacToolbarScrollSurfaces.all(in: window) where scroll.isDescendant(of: root) {
                self.observe(scroll)
            }
            let detailFrame = self.convert(self.bounds, to: window)
            let safeTop = self.convert(self.safeAreaLayoutGuide.layoutFrame, to: window).minY
            func search(_ view: UIView) {
                guard view !== self, !view.isHidden, view.alpha > 0 else { return }
                if let scroll = view as? UIScrollView, !(scroll is UITextView), let parent = scroll.superview {
                    let frame = parent.convert(scroll.frame, to: window)
                    // Full-height content under this toolbar only: exclude horizontal
                    // suggestions, composer editors, sheets and popovers.
                    if frame.intersection(detailFrame).width > 150, frame.height > 150,
                       frame.minY <= safeTop + 1, frame.maxY > detailFrame.minY + 150 {
                        self.observe(scroll)
                    }
                }
                for subview in view.subviews { search(subview) }
            }
            search(root)
        }
    }
}
#endif
