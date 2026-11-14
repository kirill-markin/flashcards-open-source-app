import SwiftUI
import UIKit

/// How a section's child screen appears: a sheet over the window, or a page pushed inside the section's own stack so it
/// stays in its half beside the side chat.
enum SectionChildPresentationStyle {
    case sheet
    case push
}

extension EnvironmentValues {
    /// `.push` inside a child screen its section pushed instead of presenting as a sheet. Such a screen leaves its
    /// navigation stack to the section and its Cancel, Close or Done dismiss button to Back. A page it pushes with a
    /// view-based `NavigationLink` takes the stack's environment instead, so the screen passes the style on.
    @Entry var sectionChildPresentationStyle: SectionChildPresentationStyle = .sheet
    /// The pushed page's discard action, which its editor's back guard fills in.
    @Entry var sectionChildDiscard: SectionChildDiscard? = nil
}

extension View {
    /// A section's child screen: pushed inside the section's own stack while the side chat shares the window, and
    /// otherwise the sheet `sheet` builds around it. The style is chosen when the screen appears and kept until it
    /// leaves, so closing the side chat widens a pushed page. `onDismiss` runs after either style leaves.
    func sectionChildPresentation<Screen: View, SheetContent: View>(
        isPresented: Binding<Bool>,
        onDismiss: (() -> Void)?,
        @ViewBuilder screen: @escaping () -> Screen,
        @ViewBuilder sheet: @escaping (Screen) -> SheetContent
    ) -> some View {
        #if targetEnvironment(macCatalyst)
        self.sheet(isPresented: isPresented, onDismiss: onDismiss) {
            sheet(screen())
        }
        #else
        self.modifier(SectionChildPresentationModifier(
            isPresented: isPresented,
            onDismiss: onDismiss,
            screen: screen,
            sheet: sheet
        ))
        #endif
    }

    /// The item form of `sectionChildPresentation(isPresented:)`; as a sheet it replaces itself when the item changes.
    func sectionChildPresentation<Item: Identifiable, Screen: View, SheetContent: View>(
        item: Binding<Item?>,
        onDismiss: (() -> Void)?,
        @ViewBuilder screen: @escaping (Item) -> Screen,
        @ViewBuilder sheet: @escaping (Item, Screen) -> SheetContent
    ) -> some View {
        #if targetEnvironment(macCatalyst)
        self.sheet(item: item, onDismiss: onDismiss) { presentedItem in
            sheet(presentedItem, screen(presentedItem))
        }
        #else
        self.modifier(SectionChildItemPresentationModifier(
            item: item,
            fixedStyle: nil,
            onDismiss: onDismiss,
            screen: screen,
            sheet: sheet
        ))
        #endif
    }

    /// The push half alone, for a child whose presenter already chose the push and whose sheet a window-level host
    /// presents otherwise.
    @ViewBuilder
    func sectionChildPush<Item: Identifiable, Screen: View>(
        item: Binding<Item?>,
        @ViewBuilder screen: @escaping (Item) -> Screen
    ) -> some View {
        #if targetEnvironment(macCatalyst)
        self
        #else
        self.modifier(SectionChildItemPresentationModifier(
            item: item,
            fixedStyle: .push,
            onDismiss: nil,
            screen: screen,
            sheet: { _, _ in EmptyView() }
        ))
        #endif
    }

    /// A pushed editor's Back. While `isLocked` it steps aside with the swipes, and with unsaved changes the Back and
    /// the swipes ask before running `onDiscard`, so none drops the draft. A sheet keeps its own controls.
    func sectionChildBackGuard(isLocked: Bool, hasUnsavedChanges: Bool, onDiscard: @escaping () -> Void) -> some View {
        self.modifier(SectionChildBackGuard(isLocked: isLocked, hasUnsavedChanges: hasUnsavedChanges, onDiscard: onDiscard))
    }
}

#if !targetEnvironment(macCatalyst)
/// The style chosen when the child appeared, kept until it leaves. The side chat is read only while the child is
/// presented, so a hidden child does not update when the chat opens or closes.
@MainActor
private func sectionChildPresentationStyle(
    presentedStyle: SectionChildPresentationStyle?,
    isPresented: Bool,
    navigation: () -> AppNavigationModel
) -> SectionChildPresentationStyle {
    if let presentedStyle {
        return presentedStyle
    }
    guard isPresented else {
        return .sheet
    }
    return navigation().presentsChildScreensInHalves ? .push : .sheet
}

private struct SectionChildPresentationModifier<Screen: View, SheetContent: View>: ViewModifier {
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Binding var isPresented: Bool
    let onDismiss: (() -> Void)?
    let screen: () -> Screen
    let sheet: (Screen) -> SheetContent
    @State private var presentedStyle: SectionChildPresentationStyle?

    func body(content: Content) -> some View {
        let style = sectionChildPresentationStyle(
            presentedStyle: self.presentedStyle,
            isPresented: self.isPresented,
            navigation: { self.navigation }
        )
        content
            // The push waits for the captured style, so the page's bar lays out for a push from its first frame.
            .navigationDestination(isPresented: Binding(
                get: { self.isPresented && self.presentedStyle == .push },
                set: { isPushed in
                    if isPushed == false {
                        self.isPresented = false
                    }
                }
            )) {
                self.screen()
                    .environment(\.sectionChildPresentationStyle, .push)
                    .aiCompanionColumnPage()
            }
            .sheet(
                isPresented: Binding(
                    get: { self.isPresented && style == .sheet },
                    set: { isShown in
                        if isShown == false {
                            self.isPresented = false
                        }
                    }
                ),
                onDismiss: self.onDismiss
            ) {
                self.sheet(self.screen())
            }
            .onChange(of: self.isPresented, initial: true) { _, isPresented in
                let wasPushed = self.presentedStyle == .push
                self.presentedStyle = isPresented
                    ? sectionChildPresentationStyle(presentedStyle: nil, isPresented: true, navigation: { self.navigation })
                    : nil
                if isPresented == false && wasPushed {
                    self.onDismiss?()
                }
            }
    }

}

private struct SectionChildItemPresentationModifier<Item: Identifiable, Screen: View, SheetContent: View>: ViewModifier {
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Binding var item: Item?
    let fixedStyle: SectionChildPresentationStyle?
    let onDismiss: (() -> Void)?
    let screen: (Item) -> Screen
    let sheet: (Item, Screen) -> SheetContent
    @State private var presentedStyle: SectionChildPresentationStyle?
    /// The last pushed item, kept while Back animates the page away after the binding has cleared.
    @State private var pushedItem: Item?

    func body(content: Content) -> some View {
        let style = self.fixedStyle ?? sectionChildPresentationStyle(
            presentedStyle: self.presentedStyle,
            isPresented: self.item != nil,
            navigation: { self.navigation }
        )
        content
            .navigationDestination(isPresented: Binding(
                get: { self.item != nil && self.presentedStyle == .push },
                set: { isPushed in
                    if isPushed == false {
                        self.item = nil
                    }
                }
            )) {
                if let item = self.item ?? self.pushedItem {
                    self.screen(item)
                        .environment(\.sectionChildPresentationStyle, .push)
                        .aiCompanionColumnPage()
                }
            }
            .sheet(
                item: Binding(
                    get: { style == .sheet ? self.item : nil },
                    set: { nextItem in
                        if nextItem == nil {
                            self.item = nil
                        }
                    }
                ),
                onDismiss: self.onDismiss
            ) { presentedItem in
                self.sheet(presentedItem, self.screen(presentedItem))
            }
            .onChange(of: self.item?.id, initial: true) { _, itemID in
                let isPresented = itemID != nil
                let wasPushed = self.presentedStyle == .push
                // A new item keeps the style already chosen.
                self.presentedStyle = isPresented
                    ? self.fixedStyle ?? sectionChildPresentationStyle(
                        presentedStyle: self.presentedStyle,
                        isPresented: true,
                        navigation: { self.navigation }
                    )
                    : nil
                if self.presentedStyle == .push, let item = self.item {
                    self.pushedItem = item
                }
                if isPresented == false && wasPushed {
                    self.onDismiss?()
                }
            }
    }

}

#endif

/// A pushed editor's state for its page's Back.
struct SectionChildBackGuardState: Equatable {
    var isLocked: Bool = false
    var hasUnsavedChanges: Bool = false
}

struct SectionChildBackGuardKey: PreferenceKey {
    static let defaultValue = SectionChildBackGuardState()

    static func reduce(value: inout SectionChildBackGuardState, nextValue: () -> SectionChildBackGuardState) {
        let next = nextValue()
        value.isLocked = value.isLocked || next.isLocked
        value.hasUnsavedChanges = value.hasUnsavedChanges || next.hasUnsavedChanges
    }
}

/// Holds the editor's discard, which the page runs after its confirmation.
@MainActor
final class SectionChildDiscard {
    var perform: () -> Void = {}
}

private struct SectionChildBackGuard: ViewModifier {
    @Environment(\.sectionChildPresentationStyle) private var style: SectionChildPresentationStyle
    @Environment(\.sectionChildDiscard) private var discard: SectionChildDiscard?
    let isLocked: Bool
    let hasUnsavedChanges: Bool
    let onDiscard: () -> Void

    func body(content: Content) -> some View {
        #if targetEnvironment(macCatalyst)
        content
        #else
        if self.style == .push {
            // The page's Back reads this; it owns the Back, the swipes and the confirmation.
            content
                .preference(
                    key: SectionChildBackGuardKey.self,
                    value: SectionChildBackGuardState(isLocked: self.isLocked, hasUnsavedChanges: self.hasUnsavedChanges)
                )
                .onAppear {
                    self.discard?.perform = self.onDiscard
                }
        } else {
            content
        }
        #endif
    }
}

#if !targetEnvironment(macCatalyst)
/// A pushed section page's Back. Beside the side chat under iPad's top tab bar the floating tab bar covers the half's
/// leading edge, so the system Back steps aside and the page's title and a Back sit at the half's outer edge, after
/// its actions; the page's swipes still pop. A pushed editor's unsaved changes ask before the Back, either button or a
/// swipe, leaves, and while it is locked no Back is offered.
struct SectionPageBack: ViewModifier {
    @Environment(\.dismiss) private var dismiss
    @State private var title: String = ""
    @State private var backGuard = SectionChildBackGuardState()
    @State private var discard = SectionChildDiscard()
    @State private var isDiscardConfirmationPresented: Bool = false
    let usesTrailingBack: Bool
    /// The title's widest extent; it is left out when even a short one does not fit.
    let trailingTitleWidth: CGFloat?

    func body(content: Content) -> some View {
        let interceptsBack = self.backGuard.hasUnsavedChanges && self.backGuard.isLocked == false
        let showsTitle = (self.trailingTitleWidth ?? .infinity) >= appMinimumTouchTarget && self.title.isEmpty == false
        content
            .environment(\.sectionChildDiscard, self.discard)
            .onPreferenceChange(PageNavigationTitleKey.self) { title in
                self.title = title
            }
            .onPreferenceChange(SectionChildBackGuardKey.self) { backGuard in
                self.backGuard = backGuard
            }
            .navigationBarBackButtonHidden(self.usesTrailingBack || self.backGuard.isLocked)
            .toolbar {
                if self.usesTrailingBack {
                    // An empty title view keeps the system title out of the bar's leading edge.
                    ToolbarItem(placement: .principal) {
                        Color.clear.frame(width: 1, height: 1)
                            .accessibilityHidden(true)
                    }
                    if showsTitle {
                        self.trailingTitle
                    }
                    if self.backGuard.isLocked == false {
                        self.trailingBack(interceptsBack: interceptsBack)
                    }
                }
            }
            .background {
                SectionPageBackController(
                    interceptsBack: interceptsBack,
                    restoresPopGestures: self.usesTrailingBack && self.backGuard.isLocked == false,
                    onBack: {
                        self.isDiscardConfirmationPresented = true
                    }
                )
                .accessibilityHidden(true)
            }
            // Anchored under the Back it answers.
            .overlay(alignment: self.usesTrailingBack ? .topTrailing : .topLeading) {
                Color.clear
                    .frame(width: 1, height: 1)
                    .confirmationDialog(
                        String(
                            localized: "editor.discard_changes.title",
                            defaultValue: "Discard changes?",
                            table: "Foundation",
                            comment: "Title asking whether to leave a pushed editor and lose its unsaved changes"
                        ),
                        isPresented: self.$isDiscardConfirmationPresented,
                        titleVisibility: .visible
                    ) {
                        Button(
                            String(
                                localized: "editor.discard_changes.discard_button",
                                defaultValue: "Discard Changes",
                                table: "Foundation",
                                comment: "Destructive button that leaves an editor and loses its unsaved changes"
                            ),
                            role: .destructive,
                            action: { self.discard.perform() }
                        )
                        Button(
                            String(
                                localized: "editor.discard_changes.keep_editing_button",
                                defaultValue: "Keep Editing",
                                table: "Foundation",
                                comment: "Button that stays in an editor instead of discarding its unsaved changes"
                            ),
                            role: .cancel
                        ) {}
                    }
            }
    }

    @ToolbarContentBuilder
    private var trailingTitle: some ToolbarContent {
        let title = ToolbarItem(placement: .topBarTrailing) {
            Text(self.title)
                .font(.headline)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: self.trailingTitleWidth, alignment: .trailing)
                .fixedSize(horizontal: self.trailingTitleWidth == nil, vertical: false)
                .accessibilityAddTraits(.isHeader)
        }
        if #available(iOS 26.0, *) {
            title.sharedBackgroundVisibility(.hidden)
        } else {
            title
        }
    }

    @ToolbarContentBuilder
    private func trailingBack(interceptsBack: Bool) -> some ToolbarContent {
        let back = ToolbarItem(placement: .topBarTrailing) {
            Button {
                if interceptsBack {
                    self.isDiscardConfirmationPresented = true
                } else {
                    self.dismiss()
                }
            } label: {
                Label(aiSettingsLocalized("common.back", "Back"), systemImage: "chevron.backward")
                    .nativeToolbarIconLabel()
            }
            .tint(Color.primary)
            .nativeToolbarIconButton()
            .accessibilityIdentifier("BackButton")
        }
        if #available(iOS 26.0, *) {
            back.sharedBackgroundVisibility(.hidden)
        } else {
            back
        }
    }
}

/// The page's system Back and its swipes. While `interceptsBack` a swipe that would pop runs `onBack` instead, as the
/// system Back does; while `restoresPopGestures` the system Back is hidden, which turns its swipes off, so they answer
/// for themselves until the page leaves.
private struct SectionPageBackController: UIViewControllerRepresentable {
    let interceptsBack: Bool
    let restoresPopGestures: Bool
    let onBack: () -> Void

    func makeUIViewController(context: Context) -> BackController {
        BackController()
    }

    func updateUIViewController(_ controller: BackController, context: Context) {
        controller.onBack = self.onBack
        controller.update(interceptsBack: self.interceptsBack, restoresPopGestures: self.restoresPopGestures)
    }

    static func dismantleUIViewController(_ controller: BackController, coordinator: ()) {
        controller.update(interceptsBack: false, restoresPopGestures: false)
    }

    final class BackController: UIViewController {
        var onBack: () -> Void = {}
        private var interceptsBack: Bool = false
        private var restoresPopGestures: Bool = false
        private var isOnTop: Bool = false
        private weak var page: UIViewController?
        private var popDelegates: [(recognizer: UIGestureRecognizer, delegate: PopGestureDelegate)] = []

        override func viewDidLoad() {
            super.viewDidLoad()
            self.view.isUserInteractionEnabled = false
        }

        override func viewWillAppear(_ animated: Bool) {
            super.viewWillAppear(animated)
            self.apply()
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            self.isOnTop = true
            self.apply()
        }

        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            // A page pushed above this one, or the pop itself, gets the stack's swipes back.
            self.isOnTop = false
            self.restoreDelegates()
        }

        func update(interceptsBack: Bool, restoresPopGestures: Bool) {
            guard interceptsBack != self.interceptsBack || restoresPopGestures != self.restoresPopGestures else {
                return
            }
            self.interceptsBack = interceptsBack
            self.restoresPopGestures = restoresPopGestures
            self.apply()
        }

        private func shouldBeginPop() -> Bool {
            guard let navigationController = self.page?.navigationController,
                  navigationController.viewControllers.count > 1, navigationController.transitionCoordinator == nil else {
                return false
            }
            if self.interceptsBack {
                self.onBack()
                return false
            }
            return true
        }

        private func apply() {
            if self.page == nil {
                self.page = self.pushedPage()
            }
            guard let page = self.page else {
                return
            }
            // SwiftUI never sets `backAction`, so the page owns it. A back action shows the system Back again, so a
            // hidden one is left without.
            page.navigationItem.backAction = self.interceptsBack && self.restoresPopGestures == false
                ? UIAction { [weak self] _ in self?.onBack() }
                : nil
            if (self.restoresPopGestures || self.interceptsBack) && self.isOnTop {
                self.installDelegates()
            } else {
                self.restoreDelegates()
            }
        }

        private var popGestures: [UIGestureRecognizer] {
            guard let navigationController = self.page?.navigationController else { return [] }
            var gestures: [UIGestureRecognizer] = []
            if let pop = navigationController.interactivePopGestureRecognizer {
                gestures.append(pop)
            }
            if #available(iOS 26.0, *), let contentPop = navigationController.interactiveContentPopGestureRecognizer {
                gestures.append(contentPop)
            }
            return gestures
        }

        private func installDelegates() {
            guard self.popDelegates.isEmpty else { return }
            for gesture in self.popGestures {
                let delegate = PopGestureDelegate(original: gesture.delegate) { [weak self] in
                    self?.shouldBeginPop() ?? false
                }
                self.popDelegates.append((gesture, delegate))
                gesture.delegate = delegate
            }
        }

        private func restoreDelegates() {
            for installed in self.popDelegates where installed.recognizer.delegate === installed.delegate {
                installed.recognizer.delegate = installed.delegate.original
            }
            self.popDelegates = []
        }

        /// The stack entry this controller is hosted in.
        private func pushedPage() -> UIViewController? {
            var candidate = self.parent
            while let controller = candidate {
                if controller.navigationController?.viewControllers.contains(where: { $0 === controller }) == true {
                    return controller
                }
                candidate = controller.parent
            }
            return nil
        }
    }
}

/// Decides whether a stack's pop gesture may begin for its page and passes the questions about other gestures to the
/// stack's own delegate, so a pop still waits for a text selection or a horizontal scroll. The stack's answers about
/// receiving touches and events turn them all away while its Back is hidden, so those stay here. It holds that
/// delegate weakly; the stack owns it.
private final class PopGestureDelegate: NSObject, UIGestureRecognizerDelegate {
    nonisolated(unsafe) weak var original: UIGestureRecognizerDelegate?
    private let shouldBegin: () -> Bool

    init(original: UIGestureRecognizerDelegate?, shouldBegin: @escaping () -> Bool) {
        self.original = original
        self.shouldBegin = shouldBegin
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        self.shouldBegin()
    }

    nonisolated override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || self.forwards(aSelector)
    }

    nonisolated override func forwardingTarget(for aSelector: Selector!) -> Any? {
        self.forwards(aSelector) ? self.original : super.forwardingTarget(for: aSelector)
    }

    private nonisolated func forwards(_ selector: Selector) -> Bool {
        NSStringFromSelector(selector).contains("shouldReceive") == false && self.original?.responds(to: selector) == true
    }
}
#endif
