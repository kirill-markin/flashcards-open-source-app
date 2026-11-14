import SwiftUI
import UIKit

/// A page the side chat opens above its live chat on iOS.
enum AICompanionPaneRoute: Hashable {
    case history(AIChatHistoryListRoute)
    case reader(AIChatHistoryReaderRoute)
    case fullResponse(AIChatFullResponseRoute)
}

extension EnvironmentValues {
    /// True on the side chat's pages on iOS, which open the pages they lead to in the pane and hold their actions in
    /// its row.
    @Entry var aiCompanionPaneOpensPages: Bool = false
}

#if !targetEnvironment(macCatalyst)
/// The bar row beside the side chat: the section's bar, which hosts the floating top tab bar where there is one, and the
/// tab bar's span, so the pane's row lines up with the bar and a pushed page's title stays clear of the tab bar.
@MainActor
@Observable
final class AICompanionRowMetrics {
    /// The section's bar in the window.
    var sectionBarFrame: CGRect?
    /// The top of the pane's row in the window, before the row moves to the bar.
    var paneRowTop: CGFloat?
    var tabBarSpan: ClosedRange<CGFloat>?
    var windowWidth: CGFloat?

    var sectionBarHeight: CGFloat? {
        self.sectionBarFrame?.height
    }

    /// How far below the pane's row the section's bar starts, as on Duo's inner display, whose status bar sits over the
    /// section only; negative when the bar sits higher. UIKit also moves the bar while a floating keyboard is held at
    /// the top of the window.
    var rowOffset: CGFloat {
        guard let bar = self.sectionBarFrame, let rowTop = self.paneRowTop else { return 0 }
        return bar.minY - rowTop
    }
}

extension EnvironmentValues {
    /// Set on the section half inside `AICompanionColumns`.
    @Entry var aiCompanionRowMetrics: AICompanionRowMetrics? = nil
}

/// The side chat on iOS: the live chat and the pages it opens above it. UIKit hosts the floating top tab bar in a tab's
/// navigation bar only while the tab holds a single child controller, so the pane has no navigation controller: it
/// draws one row in the tab bar's row for whichever page is on top, and moves its own pages, sharing one path across
/// every section's pane.
struct AICompanionPane<RootRow: View, LiveChat: View>: View {
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.aiCompanionRowMetrics) private var metrics: AICompanionRowMetrics?
    @Environment(\.aiCompanionPaneSlide) private var slide
    @State private var dragOffset: CGFloat = 0
    @State private var leadingEdge = AICompanionPaneLeadingEdge()
    let rootRow: RootRow
    let liveChat: LiveChat

    init(@ViewBuilder rootRow: () -> RootRow, @ViewBuilder liveChat: () -> LiveChat) {
        self.rootRow = rootRow()
        self.liveChat = liveChat()
    }

    var body: some View {
        GeometryReader { geometry in
            // The section's bar starts at the safe area's top, like the pane's row; without a measured bar the row
            // takes a standard bar's height.
            let rowHeight = max(appMinimumTouchTarget, self.metrics?.sectionBarHeight ?? 50)
            let rowOffset = self.metrics?.rowOffset ?? 0
            let rowWidth = self.rowWidth
            let routes = self.navigation.aiCompanionPath
            ZStack {
                self.liveChat
                    .accessibilityHidden(routes.isEmpty == false)
                ForEach(Array(routes.enumerated()), id: \.offset) { index, route in
                    let isTop = index == routes.count - 1
                    AICompanionPanePage(route: route)
                        .background(Color(uiColor: .systemBackground))
                        .offset(x: isTop ? self.dragOffset : 0)
                        .gesture(AICompanionPaneBackSwipe(
                            leadingEdge: self.leadingEdge,
                            isEnabled: isTop,
                            onChanged: { self.dragOffset = $0 },
                            onEnded: { distance, velocity in
                                self.finishBackSwipe(distance: distance, velocity: velocity, width: geometry.size.width)
                            }
                        ))
                        .accessibilityHidden(isTop == false)
                        .transition(.move(edge: .trailing))
                        .zIndex(Double(index + 1))
                }
            }
            .animation(self.reduceMotion ? nil : .smooth(duration: 0.35), value: routes.count)
            .clipShape(AICompanionPaneSideClip())
            .background(AICompanionPaneLeadingEdge.Reader(edge: self.leadingEdge, isRightToLeft: self.layoutDirection == .rightToLeft))
            // One row for every layer; their pages scroll under its band, as under a bar.
            .safeAreaInset(edge: .top, spacing: 0) {
                self.row(routes: routes, width: geometry.size.width, rowWidth: rowWidth)
                    // A bar centers its controls in its top 44 points, so the pane's controls sit there too.
                    .frame(height: appMinimumTouchTarget)
                    .frame(maxWidth: .infinity, maxHeight: rowHeight, alignment: .topLeading)
                    .frame(height: rowHeight, alignment: .top)
                    // A negative offset lifts the row and shortens the inset without moving the row's top reader.
                    .padding(.top, rowOffset)
                    .background(.bar, ignoresSafeAreaEdges: .top)
                    .background {
                        if let metrics = self.metrics {
                            AICompanionPaneRowTopReader(metrics: metrics)
                        }
                    }
                    // The row stays put while the pane slides in or out beneath it.
                    .offset(x: -self.slide)
            }
            .overlay(alignment: .trailing) {
                if UIDevice.current.userInterfaceIdiom == .pad {
                    // Starts under the row, like the band beside it.
                    HStack(spacing: 0) { Divider() }
                        .frame(width: 1)
                        .padding(.top, rowOffset + rowHeight)
                        .ignoresSafeArea(.container, edges: .bottom)
                }
            }
        }
        .environment(\.aiChatPushesFullResponse, true)
        .environment(\.aiCompanionPaneOpensPages, true)
    }

    /// The top page's row. While a swipe pulls that page away, the row beneath fades in as the page leaves, as a bar's
    /// items do; only then is it built, so a covered page never leaves controls behind.
    private func row(routes: [AICompanionPaneRoute], width: CGFloat, rowWidth: CGFloat?) -> some View {
        let progress = width > 0 ? min(1, self.dragOffset / width) : 0
        return ZStack(alignment: .topLeading) {
            if self.dragOffset > 0 {
                self.row(for: routes.dropLast().last, rowWidth: rowWidth)
                    .opacity(progress)
            }
            self.row(for: routes.last, rowWidth: rowWidth)
                .opacity(1 - progress)
                .id(routes.count)
                .transition(.opacity)
        }
        .animation(self.reduceMotion ? nil : .smooth(duration: 0.25), value: routes.count)
    }

    @ViewBuilder
    private func row(for route: AICompanionPaneRoute?, rowWidth: CGFloat?) -> some View {
        if let route {
            AICompanionPanePageRow(route: route, rowWidth: rowWidth, onBack: self.pop)
        } else {
            self.rootRow
        }
    }

    private func pop() {
        guard self.navigation.aiCompanionPath.isEmpty == false else { return }
        self.navigation.aiCompanionPath.removeLast()
    }

    /// The row's room before the floating tab bar. On iPad the pane holds the window's leading edge, which is its right
    /// edge in a right-to-left language.
    private var rowWidth: CGFloat? {
        guard let span = self.metrics?.tabBarSpan else { return nil }
        guard self.layoutDirection == .rightToLeft else { return max(0, span.lowerBound) }
        return self.metrics?.windowWidth.map { max(0, $0 - span.upperBound) }
    }

    /// Completes the pop past a third of the pane or on a quick flick, as a stack's Back swipe does, or settles back.
    private func finishBackSwipe(distance: CGFloat, velocity: CGFloat, width: CGFloat) {
        let commits = distance > width * 0.35 || distance + velocity * 0.25 > width * 0.6
        if commits {
            withAnimation(.smooth(duration: 0.25)) {
                self.dragOffset = width
            } completion: {
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    self.pop()
                    self.dragOffset = 0
                }
            }
        } else {
            withAnimation(.smooth(duration: 0.25)) {
                self.dragOffset = 0
            }
        }
    }
}

/// The pane's leading edge in the window, read from a view inside the pane, so the Back swipe finds it in either
/// layout direction and whichever side of the window holds the pane.
@MainActor
final class AICompanionPaneLeadingEdge {
    fileprivate weak var view: UIView?
    fileprivate var isRightToLeft = false

    /// Toward the pane's trailing edge on screen.
    var forwardSign: CGFloat {
        self.isRightToLeft ? -1 : 1
    }

    var windowX: CGFloat? {
        guard let view = self.view, view.window != nil else { return nil }
        let frame = view.convert(view.bounds, to: nil)
        return self.isRightToLeft ? frame.maxX : frame.minX
    }

    struct Reader: UIViewRepresentable {
        let edge: AICompanionPaneLeadingEdge
        let isRightToLeft: Bool

        func makeUIView(context: Context) -> UIView {
            let view = UIView()
            view.isUserInteractionEnabled = false
            return view
        }

        func updateUIView(_ uiView: UIView, context: Context) {
            self.edge.view = uiView
            self.edge.isRightToLeft = self.isRightToLeft
        }
    }
}

/// The pane's Back swipe. A UIKit pan claims only a drag that starts at the pane's leading edge and heads toward its
/// trailing edge, so vertical scrolls and text selection keep every other touch, and the page follows the finger.
private struct AICompanionPaneBackSwipe: UIGestureRecognizerRepresentable {
    let leadingEdge: AICompanionPaneLeadingEdge
    let isEnabled: Bool
    let onChanged: (CGFloat) -> Void
    let onEnded: (_ distance: CGFloat, _ velocity: CGFloat) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator {
        Coordinator(leadingEdge: self.leadingEdge)
    }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let recognizer = UIPanGestureRecognizer()
        recognizer.delegate = context.coordinator
        return recognizer
    }

    func updateUIGestureRecognizer(_ recognizer: UIPanGestureRecognizer, context: Context) {
        recognizer.isEnabled = self.isEnabled
    }

    func handleUIGestureRecognizerAction(_ recognizer: UIPanGestureRecognizer, context: Context) {
        let sign = self.leadingEdge.forwardSign
        let distance = max(0, recognizer.translation(in: nil).x * sign)
        switch recognizer.state {
        case .changed:
            self.onChanged(distance)
        case .ended:
            self.onEnded(distance, recognizer.velocity(in: nil).x * sign)
        case .cancelled, .failed:
            self.onEnded(0, 0)
        default:
            break
        }
    }

    @MainActor
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        private let leadingEdge: AICompanionPaneLeadingEdge

        init(leadingEdge: AICompanionPaneLeadingEdge) {
            self.leadingEdge = leadingEdge
        }

        func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard let edgeX = self.leadingEdge.windowX else { return false }
            return abs(touch.location(in: nil).x - edgeX) <= 24
        }

        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let pan = recognizer as? UIPanGestureRecognizer else { return false }
            let velocity = pan.velocity(in: nil)
            return velocity.x * self.leadingEdge.forwardSign > abs(velocity.y)
        }

        /// A scroll view that the drag starts in waits, as it does for a stack's edge swipe.
        func gestureRecognizer(
            _ recognizer: UIGestureRecognizer,
            shouldBeRequiredToFailBy otherRecognizer: UIGestureRecognizer
        ) -> Bool {
            otherRecognizer is UIPanGestureRecognizer && otherRecognizer.view is UIScrollView
        }
    }
}

/// Keeps a sliding page inside the pane's sides only, so pages still scroll under the row and the home indicator.
private struct AICompanionPaneSideClip: Shape {
    func path(in rect: CGRect) -> Path {
        Path(rect.insetBy(dx: 0, dy: -rect.height))
    }
}

/// One page of the pane, below the pane's row.
private struct AICompanionPanePage: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    let route: AICompanionPaneRoute

    var body: some View {
        switch self.route {
        case .history(let route):
            AIChatHistoryView(chatStore: self.store.aiChatStore, model: route.model)
        case .reader(let route):
            AIChatHistoryReaderView(
                chatStore: self.store.aiChatStore,
                summary: route.summary,
                model: route.list.readerModel(sessionId: route.summary.sessionId)
            )
        case .fullResponse(let route):
            AIChatFullResponsePage(route: route)
        }
    }
}

/// A page's row: Back, then the title, then the page's actions, at the pane's outer edge; the title gives way first.
private struct AICompanionPanePageRow: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    let route: AICompanionPaneRoute
    let rowWidth: CGFloat?
    let onBack: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: self.onBack) {
                Label(aiSettingsLocalized("common.back", "Back"), systemImage: "chevron.backward")
                    .nativeToolbarIconLabel()
            }
            .tint(Color.primary)
            .nativeToolbarIconButton()
            .accessibilityIdentifier(UITestIdentifier.aiCompanionBackButton)
            Text(self.title)
                .font(.headline)
                .lineLimit(1)
                .truncationMode(.tail)
                .layoutPriority(-1)
                .accessibilityAddTraits(.isHeader)
            self.actions
        }
        .padding(.horizontal, aiChatCompanionHeaderHorizontalPadding)
        .frame(maxWidth: self.rowWidth, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var title: String {
        switch self.route {
        case .history:
            aiSettingsLocalized("ai.history.title", "Chat history")
        case .reader(let route):
            route.summary.title ?? aiChatHistoryUntitledChatTitle()
        case .fullResponse:
            aiSettingsLocalized("ai.message.fullResponse.title", "Full response")
        }
    }

    @ViewBuilder
    private var actions: some View {
        if case .fullResponse(let route) = self.route {
            Button(aiSettingsLocalized("common.copy", "Copy"), systemImage: "doc.on.doc") {
                UIPasteboard.general.string = aiChatFullResponseLiveText(route: route, chatStore: self.store.aiChatStore)
            }
            .labelStyle(.iconOnly)
            .accessibilityLabel(aiSettingsLocalized("ai.tool.copy.response", "Copy response"))
            .tint(Color.primary)
            .nativeToolbarIconButton()
        }
    }
}

/// The section's bar and the floating top tab bar's span, read from the window's views whenever the bar can move: the
/// window's size, its safe area, a keyboard's frame. UIKit offers no public frame for either, and a page's own safe area
/// also counts a `safeAreaBar` below it.
struct AICompanionBarReader: UIViewRepresentable {
    let metrics: AICompanionRowMetrics

    func makeUIView(context: Context) -> ReaderView {
        let view = ReaderView()
        view.metrics = self.metrics
        return view
    }

    func updateUIView(_ uiView: ReaderView, context: Context) {
        uiView.metrics = self.metrics
        uiView.tabBarPlacement = context.environment.tabBarPlacement
    }

    final class ReaderView: UIView {
        weak var metrics: AICompanionRowMetrics?
        private var measuredWindowSize: CGSize?
        private var measuredSize: CGSize?
        private var isMeasureScheduled = false
        private weak var tabBarView: UIView?
        private weak var observedBar: UIView?
        private var barObservations: [NSKeyValueObservation] = []

        /// The tab bar moves into or out of the bar when the sidebar shows or hides, without resizing the window.
        var tabBarPlacement: TabBarPlacement? {
            didSet {
                guard oldValue != nil, self.tabBarPlacement != oldValue else { return }
                self.measure()
                // Read again once the tab bar's move has settled.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
                    self?.measure()
                }
            }
        }

        override init(frame: CGRect) {
            super.init(frame: frame)
            self.isUserInteractionEnabled = false
            self.isHidden = true
            for name in [UIResponder.keyboardDidChangeFrameNotification, UIResponder.keyboardDidHideNotification] {
                NotificationCenter.default.addObserver(self, selector: #selector(self.measure), name: name, object: nil)
            }
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            self.measure()
        }

        override func safeAreaInsetsDidChange() {
            super.safeAreaInsetsDidChange()
            self.measure()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            // Until both are found, each layout looks again; the columns also resize as the sidebar shows or hides.
            if self.window?.bounds.size != self.measuredWindowSize || self.bounds.size != self.measuredSize
                || self.metrics?.sectionBarFrame == nil {
                self.measuredSize = self.bounds.size
                self.measure()
            }
        }

        /// Measured once the current layout pass has placed the bars, and UIKit can lay out while SwiftUI is updating.
        @objc private func measure() {
            guard self.isMeasureScheduled == false else { return }
            self.isMeasureScheduled = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.isMeasureScheduled = false
                guard let window = self.window, let metrics = self.metrics else { return }
                let tabBar = self.floatingTabBar(in: window).map { $0.convert($0.bounds, to: window) }
                let bar = self.sectionBar(in: self.sectionView(in: window), window: window, tabBar: tabBar)
                self.observe(bar: bar?.view, in: window)
                self.measuredWindowSize = bar == nil ? nil : window.bounds.size
                let span = tabBar.map { $0.minX...$0.maxX }
                if metrics.tabBarSpan != span {
                    metrics.tabBarSpan = span
                }
                if metrics.sectionBarFrame != bar?.frame {
                    metrics.sectionBarFrame = bar?.frame
                }
                if metrics.windowWidth != window.bounds.width {
                    metrics.windowWidth = window.bounds.width
                }
            }
        }

        /// UIKit can move the bar without resizing anything, as while a floating keyboard is held at the top of the
        /// window, so the bar and each view above it report their own moves.
        private func observe(bar: UIView?, in window: UIWindow) {
            guard bar !== self.observedBar else { return }
            self.observedBar = bar
            self.barObservations = []
            var view = bar
            while let current = view, current !== window {
                self.barObservations.append(current.layer.observe(\.position) { [weak self] _, _ in
                    self?.barLayerDidChange()
                })
                self.barObservations.append(current.layer.observe(\.bounds) { [weak self] _, _ in
                    self?.barLayerDidChange()
                })
                view = current.superview
            }
        }

        /// Key-value observation reports on the thread that set the layer, which UIKit keeps on the main thread.
        nonisolated private func barLayerDidChange() {
            if Thread.isMainThread {
                MainActor.assumeIsolated { self.measureIfBarMoved() }
            } else {
                DispatchQueue.main.async {
                    MainActor.assumeIsolated { self.measureIfBarMoved() }
                }
            }
        }

        /// A large title resizes the bar on every scrolled frame without moving its top, so only a moved top measures.
        private func measureIfBarMoved() {
            guard let bar = self.observedBar, let window = self.window,
                  bar.convert(bar.bounds, to: window).minY != self.metrics?.sectionBarFrame?.minY else { return }
            self.measure()
        }

        /// The floating tab bar, kept while it stays shown so a measure walks the window only when it has to find it.
        private func floatingTabBar(in window: UIWindow) -> UIView? {
            if let tabBar = self.tabBarView, Self.isShown(tabBar, in: window) {
                return tabBar
            }
            let tabBar = Self.views(under: window) {
                NSStringFromClass(type(of: $0)).hasSuffix("FloatingTabBarSelectionContainerView")
            }.first
            self.tabBarView = tabBar
            return tabBar
        }

        /// The section's top bar, in the tab bar's row where there is one; the observed bar is kept while it still is.
        private func sectionBar(in section: UIView, window: UIWindow, tabBar: CGRect?) -> (view: UIView, frame: CGRect)? {
            func isRowBar(_ frame: CGRect) -> Bool {
                frame.minY < window.bounds.height / 3 && (tabBar.map { frame.minY <= $0.midY && frame.maxY >= $0.midY } ?? true)
            }
            if let bar = self.observedBar, Self.isShown(bar, in: window), bar.isDescendant(of: section) {
                let frame = bar.convert(bar.bounds, to: window)
                if isRowBar(frame) {
                    return (bar, frame)
                }
            }
            return Self.views(under: section) { $0 is UINavigationBar }
                .map { (view: $0, frame: $0.convert($0.bounds, to: window)) }
                .filter { isRowBar($0.frame) }
                .min { $0.frame.minY < $1.frame.minY }
        }

        private static func isShown(_ view: UIView, in window: UIWindow) -> Bool {
            guard view.window === window, view.bounds.width > 0 else { return false }
            var current: UIView? = view
            while let ancestor = current, ancestor !== window {
                if ancestor.isHidden || ancestor.alpha == 0 {
                    return false
                }
                current = ancestor.superview
            }
            return true
        }

        /// The selected tab's view, which holds the section's bar but not a sheet's.
        private func sectionView(in window: UIWindow) -> UIView {
            var responder: UIResponder? = self
            while let current = responder {
                if let controller = current as? UIViewController, let tabs = controller.tabBarController,
                   tabs.selectedViewController === controller {
                    return controller.view
                }
                responder = current.next
            }
            return window
        }

        private static func views(under root: UIView, matching isMatch: (UIView) -> Bool) -> [UIView] {
            var views: [UIView] = []
            var pending: [UIView] = [root]
            var index = 0
            while index < pending.count {
                let view = pending[index]
                index += 1
                guard view.isHidden == false else { continue }
                if isMatch(view), view.alpha > 0, view.bounds.width > 0 {
                    views.append(view)
                }
                pending.append(contentsOf: view.subviews)
            }
            return views
        }
    }
}

/// Reads where the pane's row starts in the window, in the same coordinates as the section's bar.
private struct AICompanionPaneRowTopReader: UIViewRepresentable {
    let metrics: AICompanionRowMetrics

    func makeUIView(context: Context) -> ReaderView {
        let view = ReaderView()
        view.metrics = self.metrics
        return view
    }

    func updateUIView(_ uiView: ReaderView, context: Context) {
        uiView.metrics = self.metrics
        uiView.report()
    }

    final class ReaderView: UIView {
        weak var metrics: AICompanionRowMetrics?

        override init(frame: CGRect) {
            super.init(frame: frame)
            self.isUserInteractionEnabled = false
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        override var frame: CGRect {
            didSet { self.report() }
        }

        override var center: CGPoint {
            didSet { self.report() }
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            self.report()
        }

        override func safeAreaInsetsDidChange() {
            super.safeAreaInsetsDidChange()
            self.report()
        }

        func report() {
            // UIKit can lay out while SwiftUI is updating the view.
            DispatchQueue.main.async { [weak self] in
                guard let self, self.window != nil, let metrics = self.metrics else { return }
                let top = self.convert(self.bounds, to: nil).minY
                if metrics.paneRowTop != top {
                    metrics.paneRowTop = top
                }
            }
        }
    }
}
#endif
