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
    /// True on iPad, where the pane lives in its section's navigation stack and shares its bar; the pane's pages then
    /// carry their own headings and controls instead of navigation titles.
    @Entry var aiCompanionPaneSharesSectionBar: Bool = false
    /// The title of the page beneath a side-chat page that shares its section's bar, which its heading's Back returns to.
    @Entry var aiCompanionBackTitle: String? = nil
    /// False for a side-chat page kept beneath the next. Its bars, which SwiftUI hosts apart from the page, read it to
    /// stay out of VoiceOver too.
    @Entry var aiCompanionPaneLayerIsShown: Bool = true
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
        if UIDevice.current.userInterfaceIdiom == .pad {
            self.sectionStackPane
        } else {
            self.ownStackPane
        }
    }

    /// iPad: one navigation stack per section keeps the section's and the chat's controls on one bar, beside a floating
    /// tab bar. Every page stays mounted under the next, as in a pushed stack, so each keeps its place and content.
    private var sectionStackPane: some View {
        let path = self.navigation.aiCompanionPath
        return ZStack {
            self.liveChat
                .aiCompanionPaneLayer(isShown: path.isEmpty)
            ForEach(Array(path.enumerated()), id: \.element) { index, route in
                self.page(route: route)
                    .background(Color(uiColor: .systemBackground))
                    .environment(\.aiCompanionBackTitle, index == 0 ? aiSettingsLocalized("ai.title", "AI") : path[index - 1].title)
                    .aiCompanionPaneLayer(isShown: index == path.count - 1)
            }
        }
        .toolbar { self.toolbar }
        .environment(\.aiChatPushesFullResponse, true)
        .environment(\.aiCompanionHostTab, self.hostTab)
        .environment(\.aiCompanionPaneSharesSectionBar, true)
        .overlay(alignment: .trailing) {
            HStack(spacing: 0) { Divider() }
                .frame(width: 1)
                .allowsHitTesting(false)
        }
    }

    /// iPhone Duo's inner display keeps the pane's own stack beside the section's.
    private var ownStackPane: some View {
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

extension AICompanionPaneRoute {
    /// The page's title, as its heading shows it.
    var title: String {
        switch self {
        case .history:
            aiSettingsLocalized("ai.history.title", "Chat history")
        case .reader(let route):
            route.summary.title ?? aiChatHistoryUntitledChatTitle()
        case .fullResponse:
            aiSettingsLocalized("ai.message.fullResponse.title", "Full response")
        }
    }
}

extension View {
    /// A page of the pane, shown on top or kept beneath the next without taking touches, focus or VoiceOver.
    func aiCompanionPaneLayer(isShown: Bool) -> some View {
        self.opacity(isShown ? 1 : 0)
            .allowsHitTesting(isShown)
            .accessibilityHidden(isShown == false)
            .disabled(isShown == false)
            .environment(\.aiCompanionPaneLayerIsShown, isShown)
    }
}
#endif

extension View {
    /// A side-chat page's title: a navigation title in its own stack, or, where the pane shares its section's bar, a
    /// heading at the top of the page with the page's own controls beside it. `usesNativeTitle` false keeps a plain
    /// navigation title, for a sheet the Mac must still title.
    @ViewBuilder
    func aiCompanionPageTitle<Accessory: View>(
        _ title: String,
        sharesSectionBar: Bool,
        usesNativeTitle: Bool = true,
        @ViewBuilder accessory: () -> Accessory
    ) -> some View {
        if sharesSectionBar {
            #if targetEnvironment(macCatalyst)
            self
            #else
            self.nativeTopBar(alignment: .leading) {
                AICompanionPageHeading(title: title, accessory: accessory())
            }
            #endif
        } else if usesNativeTitle {
            self.nativeNavigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
        } else {
            self.navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
        }
    }
}

#if !targetEnvironment(macCatalyst)
/// The heading of a side-chat page that shares its section's bar: its Back returns to the page beneath, leaving the
/// bar's controls in place.
private struct AICompanionPageHeading<Accessory: View>: View {
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Environment(\.aiCompanionHostTab) private var hostTab
    @Environment(\.aiCompanionPageIsTop) private var isOnTopPage
    @Environment(\.aiCompanionBackTitle) private var backTitle
    @Environment(\.aiCompanionPaneLayerIsShown) private var isLayerShown
    let title: String
    let accessory: Accessory

    var body: some View {
        // A covered page keeps its heading's height, so its content stays put, but nothing of it can be reached.
        if self.isLayerShown {
            self.heading
        } else {
            self.heading.hidden()
        }
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                if let backTitle = self.backTitle {
                    Button(action: self.goBack) {
                        Image(systemName: "chevron.backward")
                            .font(.body.weight(.semibold))
                            .frame(minWidth: 24, minHeight: 24)
                    }
                    .buttonBorderShape(.circle)
                    .buttonStyle(.bordered)
                    .tint(Color.primary)
                    // Pages kept beneath or in other sections must not take the shortcut from the one on screen.
                    .keyboardShortcut(self.isActive ? KeyboardShortcut("[", modifiers: .command) : nil)
                    .accessibilityLabel(Text(verbatim: aiSettingsLocalized("common.back", "Back")))
                    .accessibilityValue(Text(verbatim: backTitle))
                    .accessibilityIdentifier(UITestIdentifier.aiCompanionBackButton)
                    .disabled(self.isActive == false)
                }
                Text(self.title)
                    .font(.headline)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
            }
            self.accessory
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
    }

    /// Only the pane the person sees goes back, so a pane kept in another section or beneath a pushed page cannot.
    private var isActive: Bool {
        self.navigation.isAICompanionVisible && self.navigation.selectedTab == self.hostTab && self.isOnTopPage
            && self.isLayerShown
    }

    private func goBack() {
        guard self.isActive else { return }
        _ = self.navigation.aiCompanionPath.popLast()
    }
}
#endif
