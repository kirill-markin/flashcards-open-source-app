import SwiftUI
import UIKit

enum AICompanionPaneRoute: Hashable {
    case history(AIChatHistoryListRoute)
    case reader(AICompanionHistoryReaderRoute)
    case fullResponse(AIChatFullResponseRoute)
}

struct AICompanionHistoryReaderRoute: Hashable {
    let summary: AIChatSessionHistorySummary
    let model: AIChatHistoryReaderModel

    static func == (lhs: AICompanionHistoryReaderRoute, rhs: AICompanionHistoryReaderRoute) -> Bool {
        lhs.model === rhs.model
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(ObjectIdentifier(self.model))
    }
}

extension EnvironmentValues {
    @Entry var aiCompanionHostTab: AppTab? = nil
}

#if !targetEnvironment(macCatalyst)
struct AICompanionPane<RootToolbar: ToolbarContent, LiveChat: View>: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    let hostTab: AppTab?
    let toolbar: RootToolbar
    let liveChat: LiveChat

    init(hostTab: AppTab?, @ToolbarContentBuilder toolbar: () -> RootToolbar, @ViewBuilder liveChat: () -> LiveChat) {
        self.hostTab = hostTab
        self.toolbar = toolbar()
        self.liveChat = liveChat()
    }

    var body: some View {
        NavigationStack(path: self.path) {
            self.liveChat
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { self.toolbar }
                .aiCompanionColumnPage()
                .navigationDestination(for: AICompanionPaneRoute.self) { route in
                    self.page(route: route)
                        .aiCompanionColumnPage()
                }
        }
        .environment(\.aiChatPushesFullResponse, true)
        .environment(\.aiCompanionHostTab, self.hostTab)
        .overlay(alignment: .trailing) {
            if UIDevice.current.userInterfaceIdiom == .pad {
                HStack(spacing: 0) { Divider() }
                    .frame(width: 1)
                    .allowsHitTesting(false)
            }
        }
    }

    private var path: Binding<[AICompanionPaneRoute]> {
        Binding {
            self.navigation.aiCompanionPath
        } set: { path in
            if self.navigation.isAICompanionVisible && self.navigation.selectedTab == self.hostTab {
                self.navigation.aiCompanionPath = path
            }
        }
    }

    @ViewBuilder
    private func page(route: AICompanionPaneRoute) -> some View {
        switch route {
        case .history(let route):
            AIChatHistoryView(chatStore: self.store.aiChatStore, model: route.model)
        case .reader(let route):
            AIChatHistoryReaderView(
                chatStore: self.store.aiChatStore,
                summary: route.summary,
                model: route.model
            )
        case .fullResponse(let route):
            AIChatFullResponsePage(route: route)
        }
    }
}

/// Keep both native navigation stacks below the tab controller's unobscured content boundary.
struct AICompanionTabContentInset: UIViewRepresentable {
    @Binding var inset: CGFloat

    func makeUIView(context: Context) -> InsetView {
        InsetView()
    }

    func updateUIView(_ view: InsetView, context: Context) {
        view.onInsetChange = { inset in self.inset = inset }
        view.reportInset()
    }

    final class InsetView: UIView {
        var onInsetChange: ((CGFloat) -> Void)?
        private let probe = ContentTopProbe()
        private var contentTopConstraint: NSLayoutConstraint?
        private var reportedInset: CGFloat?

        override init(frame: CGRect) {
            super.init(frame: frame)
            self.isUserInteractionEnabled = false
            self.probe.translatesAutoresizingMaskIntoConstraints = false
            self.probe.onMove = { [weak self] in self?.reportInset() }
            self.addSubview(self.probe)
            NSLayoutConstraint.activate([
                self.probe.leadingAnchor.constraint(equalTo: self.leadingAnchor),
                self.probe.widthAnchor.constraint(equalToConstant: 0),
                self.probe.heightAnchor.constraint(equalToConstant: 0)
            ])
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            self.contentTopConstraint?.isActive = false
            self.contentTopConstraint = nil
            var responder = self.next
            while let current = responder, self.window != nil {
                if let controller = current as? UIViewController,
                   let tabs = (controller as? UITabBarController) ?? controller.tabBarController {
                    let contentTop: NSLayoutYAxisAnchor
                    if #available(iOS 26.0, *) {
                        contentTop = tabs.contentLayoutGuide.topAnchor
                    } else {
                        contentTop = tabs.view.safeAreaLayoutGuide.topAnchor
                    }
                    self.contentTopConstraint = self.probe.topAnchor.constraint(equalTo: contentTop)
                    self.contentTopConstraint?.isActive = true
                    break
                }
                responder = current.next
            }
            self.reportInset()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            self.reportInset()
        }

        func reportInset() {
            guard self.onInsetChange != nil else { return }
            let inset = self.contentTopConstraint == nil ? 0 : max(0, self.probe.frame.minY)
            guard abs(inset - (self.reportedInset ?? -1)) >= 0.5 else { return }
            self.reportedInset = inset
            DispatchQueue.main.async { [weak self] in
                guard let self, self.reportedInset == inset else { return }
                self.onInsetChange?(inset)
            }
        }
    }

    private final class ContentTopProbe: UIView {
        var onMove: (() -> Void)?

        override var center: CGPoint {
            didSet {
                if self.center != oldValue { self.onMove?() }
            }
        }
    }
}
#endif
