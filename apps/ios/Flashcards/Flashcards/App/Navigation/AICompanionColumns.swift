import SwiftUI
import UIKit

/// A section beside the AI side chat. Every section uses this one layout, so the pane, its width and its divider match
/// everywhere; native edge bars keep their outer bounds and regular-width content reserves the chat's space.
struct AICompanionColumns<Content: View>: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.isKeyboardDocked) private var isKeyboardDocked
    @Environment(\.usesRegularToolbarLayout) private var usesRegularToolbarLayout
    #if !targetEnvironment(macCatalyst)
    @State private var rowMetrics: AICompanionRowMetrics = AICompanionRowMetrics()
    #endif
    private let hostTab: AppTab
    private let content: Content

    init(hostTab: AppTab, @ViewBuilder content: () -> Content) {
        self.hostTab = hostTab
        self.content = content()
    }

    init(hostTab: AppTab, content: Content) {
        self.hostTab = hostTab
        self.content = content
    }

    private var isPaneShown: Bool {
        #if targetEnvironment(macCatalyst)
        self.navigation.isAICompanionVisible && self.navigation.selectedTab == self.hostTab
        #else
        // Each section keeps its pane while the side chat is open, so switching sections never inserts or removes it;
        // only the toggle's own animation moves it.
        self.navigation.isAICompanionPaneOpen
        #endif
    }

    var body: some View {
        let isRequested = self.isPaneShown
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        // Duo chat stays on the physical left; iPad retains logical leading.
        let isLeading = isPad || self.layoutDirection == .leftToRight
        GeometryReader { geometry in
            #if targetEnvironment(macCatalyst)
            // Apply the current layout proposal immediately during a resize,
            // before the observer publishes the updated toolbar availability.
            let isVisible = isRequested && fitsMacAICompanionColumns(geometry.size)
            #else
            let isVisible = isRequested
            #endif
            let leftInset = self.layoutDirection == .leftToRight ? geometry.safeAreaInsets.leading : geometry.safeAreaInsets.trailing
            let rightInset = self.layoutDirection == .leftToRight ? geometry.safeAreaInsets.trailing : geometry.safeAreaInsets.leading
            // The content excludes native edge bars. Include their asymmetric
            // insets when locating the full window's midpoint on inner landscape.
            #if targetEnvironment(macCatalyst)
            // Keep study content dominant instead of stretching chat over half a desktop.
            let width = min(480, max(360, geometry.size.width * 0.38))
            #else
            let width = isPad
                ? geometry.size.width / 2
                : max(0, min(geometry.size.width, (geometry.size.width + rightInset - leftInset) / 2))
            #endif
            HStack(spacing: 0) {
                Color.clear
                    .frame(width: isVisible && isLeading ? width : 0)
                    .accessibilityHidden(true)
                self.content
                    .environment(\.showsAICompanionBarBackground, (isPad || self.usesRegularToolbarLayout) && isVisible)
                    #if !targetEnvironment(macCatalyst)
                    .environment(\.aiCompanionRowMetrics, self.rowMetrics)
                    #endif
                    #if targetEnvironment(macCatalyst)
                    // The geometry is known. Avoid asking rich Review text to size itself for speculative column widths.
                    .frame(width: max(0, geometry.size.width - (isVisible ? width : 0)))
                    .frame(maxHeight: .infinity)
                    #else
                    .frame(width: isPad ? geometry.size.width - (isVisible ? width : 0) : nil)
                    #endif
                Color.clear
                    .frame(width: isVisible && !isLeading ? width : 0)
                    .accessibilityHidden(true)
            }
            .overlay(alignment: isLeading ? .leading : .trailing) {
                if isVisible {
                    self.pane
                        #if !targetEnvironment(macCatalyst)
                        .environment(\.aiCompanionRowMetrics, self.rowMetrics)
                        #endif
                        .frame(width: width)
                        .overlay(alignment: isLeading ? .trailing : .leading) {
                            if isPad == false {
                                HStack(spacing: 0) { Divider() }.frame(width: 1)
                            }
                        }
                        .transition(AICompanionPaneTransition(offset: isLeading ? -width : width))
                }
            }
            // A section switch leaves this unchanged; the toggle and an availability change (rotation, a resized window,
            // a Duo fold) move the pane.
            .animation(self.reduceMotion ? nil : .smooth(duration: 0.35), value: isRequested)
        }
        #if !targetEnvironment(macCatalyst)
        .background {
            AICompanionBarReader(metrics: self.rowMetrics)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        #endif
        // The paired columns share one keyboard boundary and one layout proposal.
        .ignoresSafeArea(isPad && self.isKeyboardDocked == false ? .keyboard : [], edges: .all)
    }

    private var pane: some View {
        self.paneChat
            .ignoresSafeArea(UIDevice.current.userInterfaceIdiom == .pad || self.isKeyboardDocked || self.navigation.canPresentAICompanion == false ? [] : .keyboard, edges: .bottom)
            .background(Color(uiColor: .systemBackground))
            .presentationBackground(Color(uiColor: .systemBackground))
            #if targetEnvironment(macCatalyst)
            .onAppear {
                if self.hostTab == .review {
                    FlashcardsObservability.addBreadcrumb(.macReviewCompanionOpen(.panelAppeared))
                }
            }
            .onDisappear {
                if self.hostTab == .review && !self.navigation.isAICompanionPresented {
                    FlashcardsObservability.addBreadcrumb(.macReviewCompanionClose(.panelDisappeared))
                }
            }
            #endif
    }

    /// On iOS the chat hosts the pane's pages and its row level with the section's bar; on Mac its controls join the
    /// window toolbar.
    private var paneChat: some View {
        AIChatView(chatStore: self.store.aiChatStore, isCompanion: true, companionHostTab: self.hostTab)
    }
}

extension EnvironmentValues {
    /// True inside both halves while a wide layout, iPad or Duo's inner display, shows the side chat; their pages then
    /// keep an opaque bar band.
    @Entry var showsAICompanionBarBackground: Bool = false
    /// How far the side chat is still slid toward its edge while it opens or closes.
    @Entry var aiCompanionPaneSlide: CGFloat = 0
}

/// Slides the side chat in from its edge and fades it, telling the pane how far it is slid so its row can stay put:
/// the toggle sits at the same place in the section's bar and in the pane's row, so it never moves under a tap.
private struct AICompanionPaneTransition: Transition {
    let offset: CGFloat

    func body(content: Content, phase: TransitionPhase) -> some View {
        let slide = phase.isIdentity ? 0 : self.offset
        content
            .environment(\.aiCompanionPaneSlide, slide)
            .offset(x: slide)
            .opacity(phase.isIdentity ? 1 : 0)
    }
}

extension View {
    /// A page in a navigation stack inside `AICompanionColumns`, or in the AI tab's stack, whose chat follows the same
    /// keyboard rule. Each page is its own hosting controller, and one that returns to the window after a rotation can
    /// keep the inset of a keyboard that has since gone.
    func aiCompanionColumnPage() -> some View {
        self.modifier(AICompanionColumnPageKeyboard())
            .modifier(AICompanionColumnPageBar())
    }

    /// A page a child screen pushes itself: a column page while the child is pushed, a sheet's own page otherwise.
    @ViewBuilder
    func aiCompanionColumnPage(when style: SectionChildPresentationStyle) -> some View {
        if style == .push {
            self.aiCompanionColumnPage()
        } else {
            self
        }
    }
}

/// Beside the open side chat both halves' bars are opaque, so content scrolled up never shows behind the tab bar's
/// row; only the values change, so toggling the chat keeps the page. Under iPad's top tab bar a pushed page's title
/// follows its Back in the tab bar's row instead of taking a row of its own below it, and beside the side chat both
/// move to the section half's outer edge, since the floating tab bar covers the half's leading edge.
private struct AICompanionColumnPageBar: ViewModifier {
    @Environment(\.showsAICompanionBarBackground) private var showsBackground
    @Environment(\.isPresented) private var isPushed
    @Environment(\.tabBarPlacement) private var tabBarPlacement
    #if !targetEnvironment(macCatalyst)
    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.aiCompanionRowMetrics) private var rowMetrics: AICompanionRowMetrics?
    #endif

    func body(content: Content) -> some View {
        #if targetEnvironment(macCatalyst)
        content
        #else
        let isTopTabBar = UIDevice.current.userInterfaceIdiom == .pad && self.tabBarPlacement == .topBar
        content
            .modifier(AICompanionBarStyle())
            .toolbarBackgroundVisibility(self.showsBackground ? .visible : .automatic, for: .navigationBar)
            .toolbarRole(isTopTabBar && self.isPushed ? .editor : .automatic)
            .modifier(SectionPageBack(
                usesTrailingBack: isTopTabBar && self.isPushed && self.showsBackground && self.findsTabBarRow,
                trailingTitleWidth: self.trailingTitleWidth
            ))
        #endif
    }

    #if !targetEnvironment(macCatalyst)
    /// Whether the floating tab bar was found in the section's bar. Without it, as where UIKit lays the tab bar out
    /// differently, the page keeps the system Back and the pane a standard row.
    private var findsTabBarRow: Bool {
        self.rowMetrics?.tabBarSpan != nil && self.rowMetrics?.sectionBarHeight != nil
    }

    /// What the half beside the floating tab bar leaves for the title after Back and room for the page's actions. The
    /// section's trailing edge is the window's left edge in a right-to-left language.
    private var trailingTitleWidth: CGFloat? {
        guard let rowMetrics = self.rowMetrics, let span = rowMetrics.tabBarSpan, let windowWidth = rowMetrics.windowWidth else {
            return nil
        }
        let clearance = self.layoutDirection == .rightToLeft ? span.lowerBound : windowWidth - span.upperBound
        return clearance - 16 - appMinimumTouchTarget - 12 - 130
    }
    #endif
}

#if !targetEnvironment(macCatalyst)
/// The bar material on iPad, as main sets it, and on a phone, Duo's inner display, while the side chat is open. Any
/// navigation bar style replaces a phone's soft scroll edge, so a phone otherwise gives it to a bottom toolbar, which
/// these pages never show. Only the value changes, so neither the side chat nor a fold rebuilds the page.
private struct AICompanionBarStyle: ViewModifier {
    @Environment(\.showsAICompanionBarBackground) private var showsBackground

    func body(content: Content) -> some View {
        let isStyled = UIDevice.current.userInterfaceIdiom == .pad || self.showsBackground
        content.toolbarBackground(.bar, for: isStyled ? .navigationBar : .bottomBar)
    }
}
#endif

private struct AICompanionColumnPageKeyboard: ViewModifier {
    @Environment(\.isKeyboardDocked) private var isKeyboardDocked
    /// Follows this page's own keyboard notifications, which reach its hosting controller in the same update as the
    /// keyboard's inset, so both halves rise with a docked keyboard; the docked flag reaches a nested page later. A
    /// floating keyboard leaves the page in place, as it leaves the columns.
    @State private var isKeyboardDockedHere = false

    func body(content: Content) -> some View {
        #if targetEnvironment(macCatalyst)
        content
        #else
        content
            .ignoresSafeArea(
                UIDevice.current.userInterfaceIdiom == .pad && self.isKeyboardDocked == false && self.isKeyboardDockedHere == false
                    ? .keyboard : [],
                edges: .all
            )
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { notification in
                // A keyboard leaving the screen keeps the rule until it has gone.
                if let isDocked = dockedKeyboardFrame(notification) {
                    self.isKeyboardDockedHere = isDocked
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidHideNotification)) { _ in
                self.isKeyboardDockedHere = false
            }
        #endif
    }
}

#if !targetEnvironment(macCatalyst)
/// Whether a keyboard frame change ends docked: on screen, across its full width and at its bottom, which a docked
/// keyboard can stop a few points short of. Nil while the keyboard leaves the screen.
private func dockedKeyboardFrame(_ notification: Notification) -> Bool? {
    guard let frame = (notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue,
          let screen = notification.object as? UIScreen else { return nil }
    let bounds = screen.bounds
    guard frame.height > 0, frame.minY < bounds.maxY else { return nil }
    return frame.width >= bounds.width - 1 && frame.maxY >= bounds.maxY - 10
}
#endif

/// The AI tab's full-width chat.
struct AITabChat: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Environment(\.isKeyboardDocked) private var isKeyboardDocked

    var body: some View {
        #if targetEnvironment(macCatalyst)
        if self.navigation.selectedTab == .ai {
            GeometryReader { _ in
                AIChatView(chatStore: self.store.aiChatStore)
                    .id(self.navigation.aiTabVisitID)
            }
            .ignoresSafeArea(self.isKeyboardDocked ? [] : .keyboard, edges: .all)
        }
        #else
        if UIDevice.current.userInterfaceIdiom == .pad {
            // iPad keeps the chat across visits instead of rebuilding it; becoming visible again already returns the
            // transcript to its newest message, which the per-visit reset was for.
            // Match the paired columns: the fixed viewport owns keyboard avoidance inside the native navigation stack,
            // below its toolbar.
            GeometryReader { _ in
                AIChatView(chatStore: self.store.aiChatStore)
            }
            .ignoresSafeArea(self.isKeyboardDocked ? [] : .keyboard, edges: .all)
            // The kept chat stays out of VoiceOver and UI queries while another section, maybe with the side chat, shows.
            .accessibilityHidden(self.navigation.selectedTab != .ai)
        } else if self.navigation.selectedTab == .ai {
            AIChatView(chatStore: self.store.aiChatStore)
                .id(self.navigation.aiTabVisitID)
        }
        #endif
    }
}
