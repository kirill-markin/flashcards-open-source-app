#if targetEnvironment(macCatalyst)
import SwiftUI
import UIKit

struct MacToolbarAction {
    let identifier: String
    let symbol: String
    let label: String
    var symbolColor: UIColor? = nil
    var title: String? = nil
    var value: String? = nil
    var isEnabled: Bool = true
    var isSelected: Bool = false
    let perform: @MainActor (MacToolbarActionContext) -> Void
}

struct MacToolbarGroup {
    let identifier: String
    let actions: [MacToolbarAction]
    var usesSharedBezel: Bool = false
}

struct MacToolbarSearch {
    let text: String
    let prompt: String
    let focusRequest: UUID?
    let onChange: @MainActor (String) -> Void
    let onFocusRequestHandled: @MainActor () -> Void
}

struct MacToolbarContribution {
    enum Role { case screen, companion, navigation }
    let tab: AppTab
    var role: Role = .screen
    var leading: [MacToolbarGroup] = []
    var trailing: [MacToolbarGroup] = []
    var companionActions: [MacToolbarAction] = []
    var search: MacToolbarSearch? = nil
}

struct MacWindowToolbarConfiguration {
    let tab: AppTab
    let title: String
    let leading: [MacToolbarGroup]
    let trailing: [MacToolbarGroup]
    var search: MacToolbarSearch? = nil
}

/// The visible, closure-free part of a window toolbar configuration.
struct MacToolbarPresentation: Equatable {
    struct Action: Equatable {
        let identifier: String
        let symbol: String
        let label: String
        let symbolColor: UIColor?
        let title: String?
        let value: String?
        let isEnabled: Bool
        let isSelected: Bool
    }

    struct Group: Equatable {
        let identifier: String
        let usesSharedBezel: Bool
        let actions: [Action]
    }

    let tab: AppTab
    let title: String
    let leading: [Group]
    let trailing: [Group]
    let searchText: String?
    let searchPrompt: String?
    let searchFocusRequest: UUID?

    init(_ configuration: MacWindowToolbarConfiguration) {
        func group(_ group: MacToolbarGroup) -> Group {
            Group(identifier: group.identifier, usesSharedBezel: group.usesSharedBezel, actions: group.actions.map {
                Action(identifier: $0.identifier, symbol: $0.symbol, label: $0.label, symbolColor: $0.symbolColor,
                       title: $0.title, value: $0.value, isEnabled: $0.isEnabled, isSelected: $0.isSelected)
            })
        }
        self.tab = configuration.tab
        self.title = configuration.title
        self.leading = configuration.leading.map(group)
        self.trailing = configuration.trailing.map(group)
        self.searchText = configuration.search?.text
        self.searchPrompt = configuration.search?.prompt
        self.searchFocusRequest = configuration.search?.focusRequest
    }
}

struct MacNavigationHeader {
    let tab: AppTab
    let title: String
    let isPresented: Bool
    let dismiss: @MainActor () -> Void
}

struct MacToolbarPreferences {
    var contributions: [MacToolbarContribution] = []
    var headers: [MacNavigationHeader] = []
}

struct MacToolbarPreferenceKey: PreferenceKey {
    static var defaultValue: MacToolbarPreferences { MacToolbarPreferences() }
    static func reduce(value: inout MacToolbarPreferences, nextValue: () -> MacToolbarPreferences) {
        let next = nextValue()
        value.contributions.append(contentsOf: next.contributions)
        value.headers.append(contentsOf: next.headers)
    }
}

private struct MacToolbarOwnerTabKey: EnvironmentKey {
    static var defaultValue: AppTab? { nil }
}

extension EnvironmentValues {
    var macToolbarOwnerTab: AppTab? {
        get { self[MacToolbarOwnerTabKey.self] }
        set { self[MacToolbarOwnerTabKey.self] = newValue }
    }
}

extension View {
    func macToolbarContribution(_ contribution: MacToolbarContribution?) -> some View {
        self.background {
            MacToolbarContributionEmitter(contribution: contribution)
        }
    }
}

private struct MacToolbarContributionEmitter: View {
    @State private var isVisible = false
    let contribution: MacToolbarContribution?
    var body: some View {
        MacNavigationVisibilityObserver { self.isVisible = $0 }
            .frame(width: 1, height: 1)
            .preference(key: MacToolbarPreferenceKey.self, value: MacToolbarPreferences(contributions: self.isVisible ? self.contribution.map { [$0] } ?? [] : []))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

struct MacNavigationHeaderEmitter: View {
    @Environment(\.macToolbarOwnerTab) private var tab
    @Environment(\.dismiss) private var dismiss
    @Environment(\.isPresented) private var isPresented
    @State private var isVisible = false
    let title: String

    var body: some View {
        MacNavigationVisibilityObserver { self.isVisible = $0 }
            .frame(width: 1, height: 1)
            .preference(key: MacToolbarPreferenceKey.self, value: MacToolbarPreferences(headers: self.header))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private var header: [MacNavigationHeader] {
        guard self.isVisible, let tab else { return [] }
        return [MacNavigationHeader(tab: tab, title: self.title, isPresented: self.isPresented, dismiss: { self.dismiss() })]
    }
}

private struct MacNavigationVisibilityObserver: UIViewRepresentable {
    let onChange: (Bool) -> Void
    func makeUIView(context: Context) -> VisibilityView {
        let view = VisibilityView()
        view.isUserInteractionEnabled = false
        view.isAccessibilityElement = false
        view.accessibilityElementsHidden = true
        view.onChange = self.onChange
        return view
    }
    func updateUIView(_ view: VisibilityView, context: Context) {
        view.onChange = self.onChange
        view.reportVisibility()
    }
    final class VisibilityView: UIView {
        var onChange: ((Bool) -> Void)?
        private var lastValue: Bool?
        override func didMoveToWindow() {
            super.didMoveToWindow()
            self.reportVisibility()
            // A page's views enter the window together; the toolbar backdrop finds its scroll view.
            if self.window != nil {
                NotificationCenter.default.post(name: MacToolbarScrollSurfaces.pageDidAppear, object: self)
            }
        }
        func reportVisibility() {
            let visible = self.window != nil
            guard self.lastValue != visible else { return }
            self.lastValue = visible
            DispatchQueue.main.async { [weak self] in
                guard let self, (self.window != nil) == visible else { return }
                self.onChange?(visible)
            }
        }
    }
}

@MainActor
struct MacToolbarActionContext {
    let item: NSToolbarItem
    let presenter: UIViewController

    func presentPopover<Content: View>(isPresented: Binding<Bool>, @ViewBuilder content: @escaping () -> Content) {
        let controller = MacToolbarPopoverController(rootView: AnyView(EmptyView()))
        controller.rootView = AnyView(MacToolbarPopoverContent(isPresented: isPresented, content: content, dismiss: { [weak controller] in
            controller?.dismiss(animated: true)
        }))
        controller.onDismiss = { isPresented.wrappedValue = false }
        controller.sizingOptions = [.preferredContentSize]
        controller.modalPresentationStyle = .popover
        controller.popoverPresentationController?.sourceItem = self.item
        controller.popoverPresentationController?.delegate = controller
        self.presenter.present(controller, animated: true)
    }
}

private struct MacToolbarPopoverContent<Content: View>: View {
    @Binding var isPresented: Bool
    let content: () -> Content
    let dismiss: () -> Void
    var body: some View {
        self.content().onChange(of: self.isPresented) { _, shown in
            if shown == false { self.dismiss() }
        }
    }
}

/// A toolbar popover belongs to its section's views, which a section switch removes.
@MainActor
func dismissMacToolbarPopover(presentedBy presenter: UIViewController) {
    guard let popover = presenter.presentedViewController as? MacToolbarPopoverController,
          popover.isBeingDismissed == false else { return }
    popover.dismiss(animated: true)
}

private final class MacToolbarPopoverController: UIHostingController<AnyView>, UIPopoverPresentationControllerDelegate {
    var onDismiss: (() -> Void)?
    override func viewDidLoad() {
        super.viewDidLoad()
        // Let the system popover material show instead of the hosting view's opaque fill.
        self.view.backgroundColor = .clear
    }
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        self.onDismiss?()
        self.onDismiss = nil
    }
    func adaptivePresentationStyle(for controller: UIPresentationController) -> UIModalPresentationStyle { .none }
}
#endif
