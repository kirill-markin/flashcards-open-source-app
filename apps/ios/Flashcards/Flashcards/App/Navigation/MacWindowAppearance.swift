#if targetEnvironment(macCatalyst)
import SwiftUI
import UIKit

/// Owns only this scene's native toolbar. UIKit navigation remains screen-owned.
struct MacWindowAppearance: UIViewRepresentable {
    let configuration: MacWindowToolbarConfiguration
    let onSidebarVisibilityChange: (Bool) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(configuration: self.configuration, onSidebarVisibilityChange: self.onSidebarVisibilityChange)
    }

    func makeUIView(context: Context) -> WindowView {
        let view = WindowView()
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = false
        view.isAccessibilityElement = false
        view.accessibilityElementsHidden = true
        view.coordinator = context.coordinator
        return view
    }

    func updateUIView(_ view: WindowView, context: Context) {
        context.coordinator.onSidebarVisibilityChange = self.onSidebarVisibilityChange
        context.coordinator.update(configuration: self.configuration, view: view)
    }

    static func dismantleUIView(_ view: WindowView, coordinator: Coordinator) {
        view.coordinator = nil
        coordinator.detach()
    }

    final class WindowView: UIView {
        weak var coordinator: Coordinator?
        override func didMoveToWindow() {
            super.didMoveToWindow()
            self.coordinator?.attach(view: self)
        }
        override func layoutSubviews() {
            super.layoutSubviews()
            self.coordinator?.refreshSidebar(view: self)
        }
    }

    @MainActor
    final class Coordinator: NSObject, NSToolbarDelegate {
        private let titleIdentifier = NSToolbarItem.Identifier("nibomo.screenTitle")
        private let searchIdentifier = NSToolbarItem.Identifier("nibomo.cardSearch")
        private let sidebarIdentifier = NSToolbarItem.Identifier("nibomo.sidebarToggle")
        private var configuration: MacWindowToolbarConfiguration
        private weak var bridgeView: WindowView?
        private weak var scene: UIWindowScene?
        private weak var splitViewController: UISplitViewController?
        private var sidebarItem: NSToolbarItem?
        var onSidebarVisibilityChange: (Bool) -> Void
        private var toolbar: NSToolbar?
        private var items: [String: ActionEntry] = [:]
        private var groups: [String: GroupEntry] = [:]
        private var actions: [String: MacToolbarAction] = [:]
        private var identifiers: [NSToolbarItem.Identifier] = []
        private var titleItem: NSUIViewToolbarItem?
        private let titleLabel = UILabel()
        private var searchItem: NSUIViewToolbarItem?
        private let searchField = ToolbarSearchField()
        private var lastModelSearchText: String?
        private var consumedSearchFocusRequest: UUID?
        private var appliedPresentation: MacToolbarPresentation?

        init(configuration: MacWindowToolbarConfiguration, onSidebarVisibilityChange: @escaping (Bool) -> Void) {
            self.configuration = configuration
            self.onSidebarVisibilityChange = onSidebarVisibilityChange
            super.init()
            self.titleLabel.font = UIFont.preferredFont(forTextStyle: .headline)
            self.titleLabel.adjustsFontForContentSizeCategory = true
            self.titleLabel.backgroundColor = .clear
            self.titleLabel.textColor = .label
            self.titleLabel.numberOfLines = 1
            self.titleLabel.lineBreakMode = .byTruncatingTail
            self.titleLabel.isUserInteractionEnabled = false
            self.titleLabel.isAccessibilityElement = true
            self.titleLabel.accessibilityTraits = .header
            self.titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            self.searchField.accessibilityIdentifier = "cards.searchField"
            self.searchField.font = UIFont.preferredFont(forTextStyle: .body)
            self.searchField.adjustsFontForContentSizeCategory = true
            self.searchField.autocapitalizationType = .none
            self.searchField.autocorrectionType = .no
            self.searchField.spellCheckingType = .no
            self.searchField.returnKeyType = .search
            self.searchField.addTarget(self, action: #selector(self.searchChanged(_:)), for: .editingChanged)
            self.searchField.onWindowAvailable = { [weak self] in self?.scheduleSearchFocus() }
        }

        func update(configuration: MacWindowToolbarConfiguration, view: WindowView) {
            let didChangeTab = self.configuration.tab != configuration.tab
            if didChangeTab || self.configuration.title != configuration.title
                || self.configuration.search?.prompt != configuration.search?.prompt {
                self.searchField.resignFirstResponder()
            }
            if didChangeTab, let root = view.window?.rootViewController {
                dismissMacToolbarPopover(presentedBy: root)
            }
            self.configuration = configuration
            self.refreshSidebar(view: view)
            // Several SwiftUI passes per section switch publish the same presentation;
            // only its closures change. Skip native toolbar work when nothing visible did.
            let presentation = MacToolbarPresentation(configuration)
            if presentation == self.appliedPresentation, self.toolbar != nil, self.splitViewController != nil, self.bridgeView === view,
               let scene = view.window?.windowScene, scene === self.scene, scene.titlebar?.toolbar === self.toolbar {
                self.actions = Self.actionsByIdentifier(configuration)
                return
            }
            self.attach(view: view)
            self.appliedPresentation = presentation
        }

        private static func actionsByIdentifier(_ configuration: MacWindowToolbarConfiguration) -> [String: MacToolbarAction] {
            Dictionary((configuration.leading + configuration.trailing).flatMap(\.actions).map { ($0.identifier, $0) },
                       uniquingKeysWith: { _, latest in latest })
        }

        func attach(view: WindowView) {
            self.bridgeView = view
            guard let window = view.window, let nextScene = window.windowScene else { return }
            if self.scene !== nextScene {
                self.detach()
                self.bridgeView = view
                self.scene = nextScene
                NotificationCenter.default.addObserver(self, selector: #selector(self.activationChanged(_:)), name: UIWindow.didBecomeKeyNotification, object: window)
                NotificationCenter.default.addObserver(self, selector: #selector(self.activationChanged(_:)), name: UIScene.didActivateNotification, object: nextScene)
            }
            if self.toolbar == nil {
                let toolbar = NSToolbar(identifier: NSToolbar.Identifier("nibomo.main.\(UUID().uuidString)"))
                toolbar.delegate = self
                toolbar.displayMode = .iconOnly
                toolbar.allowsUserCustomization = false
                toolbar.allowsDisplayModeCustomization = false
                toolbar.autosavesConfiguration = false
                toolbar.centeredItemIdentifiers = []
                self.toolbar = toolbar
            }
            self.configureSidebar(in: window)
            self.refreshItems()
            if let titlebar = nextScene.titlebar, let toolbar = self.toolbar {
                if titlebar.titleVisibility != .hidden { titlebar.titleVisibility = .hidden }
                if titlebar.toolbarStyle != .unified { titlebar.toolbarStyle = .unified }
                if titlebar.toolbar !== toolbar { titlebar.toolbar = toolbar }
            }
            self.scheduleSearchFocus()
        }

        func detach() {
            NotificationCenter.default.removeObserver(self)
            self.searchField.resignFirstResponder()
            if let toolbar = self.toolbar, self.scene?.titlebar?.toolbar === toolbar {
                self.scene?.titlebar?.toolbar = nil
            }
            self.toolbar?.delegate = nil
            self.toolbar = nil
            self.groups.removeAll()
            self.titleItem = nil
            self.searchItem = nil
            self.scene = nil
            self.splitViewController = nil
            self.sidebarItem = nil
            self.bridgeView = nil
        }

        func refreshSidebar(view: WindowView) {
            guard let window = view.window, window.windowScene === self.scene else { return }
            if self.configureSidebar(in: window) {
                self.refreshItems()
            }
        }

        @discardableResult
        private func configureSidebar(in window: UIWindow) -> Bool {
            func findSplit(in controller: UIViewController) -> UISplitViewController? {
                if let split = controller as? UISplitViewController { return split }
                return controller.children.lazy.compactMap { findSplit(in: $0) }.first
            }
            let split = window.rootViewController.flatMap { findSplit(in: $0) }
            let didChangeSplit = self.splitViewController !== split
            self.splitViewController = split
            guard let split else { return didChangeSplit }
            if didChangeSplit == false, self.sidebarItem != nil { return false }
            if self.sidebarItem == nil {
                let button = UIButton(type: .system)
                var configuration = UIButton.Configuration.plain()
                configuration.image = UIImage(systemName: "sidebar.left")
                configuration.baseForegroundColor = .label
                button.configuration = configuration
                button.accessibilityIdentifier = "mac.sidebar.toggle"
                button.accessibilityLabel = String(localized: "mac.sidebar.title", table: "Foundation")
                button.addTarget(self, action: #selector(self.toggleSidebar), for: .primaryActionTriggered)
                // Keep SwiftUI's column visibility authoritative for the native split.
                let item = NSUIViewToolbarItem(itemIdentifier: self.sidebarIdentifier, uiView: button)
                item.isBordered = true
                item.label = button.accessibilityLabel ?? ""
                item.paletteLabel = item.label
                item.visibilityPriority = .high
                item.autovalidates = false
                self.sidebarItem = item
            }
            split.primaryBackgroundStyle = .sidebar
            let primary = split.viewController(for: .primary)
            primary?.viewIfLoaded?.backgroundColor = .clear
            primary?.viewIfLoaded?.isOpaque = false
            (primary as? UINavigationController)?.topViewController?.viewIfLoaded?.backgroundColor = .clear
            (primary as? UINavigationController)?.topViewController?.viewIfLoaded?.isOpaque = false
            return didChangeSplit
        }

        @objc private func toggleSidebar() {
            if let view = self.bridgeView {
                self.refreshSidebar(view: view)
            }
            guard let split = self.splitViewController, let item = self.sidebarItem,
                  self.actionContext(item: item) != nil else { return }
            let isVisible: Bool
            if #available(iOS 26.0, *) {
                isVisible = split.isShowing(.primary)
            } else {
                isVisible = !split.isCollapsed && split.displayMode != .secondaryOnly
            }
            if isVisible {
                split.hide(.primary)
            } else {
                split.show(.primary)
            }
            self.onSidebarVisibilityChange(!isVisible)
        }

        private func refreshItems() {
            guard let toolbar = self.toolbar else { return }
            let allGroups = self.configuration.leading + self.configuration.trailing
            self.actions = Self.actionsByIdentifier(self.configuration)
            for action in allGroups.filter({ !$0.usesSharedBezel }).flatMap(\.actions) { self.updateAction(action) }
            for group in allGroups where group.usesSharedBezel && !group.actions.isEmpty {
                if let entry = self.groups[group.identifier], entry.identifiers == group.actions.map(\.identifier) {
                    entry.update(actions: group.actions)
                } else {
                    let entry = GroupEntry(group: group) { [weak self] identifier, item in
                        self?.performAction(identifier: identifier, sourceItem: item)
                    }
                    self.groups[group.identifier] = entry
                    let identifier = NSToolbarItem.Identifier(group.identifier)
                    if let index = toolbar.itemIdentifiers.firstIndex(of: identifier) {
                        toolbar.removeItem(at: index)
                        toolbar.insertItem(withItemIdentifier: identifier, at: index)
                    }
                }
            }
            self.titleLabel.text = self.configuration.title
            self.titleLabel.accessibilityLabel = self.configuration.title
            self.titleLabel.accessibilityIdentifier = self.configuration.tab == .review
                ? "review.companionTitle" : "mac.toolbar.title.\(String(describing: self.configuration.tab))"
            self.titleLabel.invalidateIntrinsicContentSize()
            if self.configuration.title.isEmpty {
                self.titleItem = nil
            } else if self.titleItem == nil {
                let item = NSUIViewToolbarItem(itemIdentifier: self.titleIdentifier, uiView: self.titleLabel)
                item.isBordered = false
                item.autovalidates = false
                item.visibilityPriority = .low
                self.titleItem = item
            }
            self.titleItem?.label = self.configuration.title
            self.titleItem?.paletteLabel = self.configuration.title
            if let search = self.configuration.search {
                self.searchField.placeholder = search.prompt
                self.searchField.accessibilityLabel = search.prompt
                // An unchanged model must not replace text/cursor during an edit.
                if search.text != self.lastModelSearchText {
                    if self.searchField.text != search.text { self.searchField.text = search.text }
                    self.lastModelSearchText = search.text
                }
                self.searchField.updateToolbarFittingSize()
                if self.searchItem == nil {
                    let item = NSUIViewToolbarItem(itemIdentifier: self.searchIdentifier, uiView: self.searchField)
                    item.isBordered = ToolbarSearchField.usesToolbarPlatter
                    item.autovalidates = false
                    item.visibilityPriority = .high
                    self.searchItem = item
                }
                self.searchItem?.label = search.prompt
                self.searchItem?.paletteLabel = search.prompt
                self.searchItem?.itemMenuFormRepresentation = UIAction(title: search.prompt, image: UIImage(systemName: "magnifyingglass")) { [weak self] _ in
                    self?.focusSearchIfPossible(consumingRequest: false)
                }
            } else {
                self.searchField.resignFirstResponder()
                self.searchItem = nil
                self.lastModelSearchText = nil
            }
            func groupIdentifiers(_ groups: [MacToolbarGroup]) -> [NSToolbarItem.Identifier] {
                var result: [NSToolbarItem.Identifier] = []
                for group in groups where !group.actions.isEmpty {
                    if !result.isEmpty { result.append(.space) }
                    if group.usesSharedBezel {
                        result.append(NSToolbarItem.Identifier(group.identifier))
                    } else {
                        result += group.actions.map { NSToolbarItem.Identifier($0.identifier) }
                    }
                }
                return result
            }
            self.identifiers = (self.splitViewController == nil ? [] : [self.sidebarIdentifier, .primarySidebarTrackingSeparatorItemIdentifier])
                + groupIdentifiers(self.configuration.leading)
                + [.flexibleSpace]
                + (self.configuration.title.isEmpty ? [] : [self.titleIdentifier, .flexibleSpace])
                + groupIdentifiers(self.configuration.trailing)
                + (self.configuration.search == nil ? [] : [.space, self.searchIdentifier])
            toolbar.centeredItemIdentifiers = self.configuration.title.isEmpty ? [] : [self.titleIdentifier]
            if toolbar.itemIdentifiers != self.identifiers { toolbar.itemIdentifiers = self.identifiers }
        }

        private func updateAction(_ action: MacToolbarAction) {
            let entry: ActionEntry
            if let cached = self.items[action.identifier] {
                entry = cached
            } else {
                entry = ActionEntry(action: action) { [weak self] in
                    self?.performAction(identifier: action.identifier)
                }
                self.items[action.identifier] = entry
            }
            var image = action.symbol.isEmpty ? nil : UIImage(systemName: action.symbol)
            if let color = action.symbolColor {
                image = image?.withTintColor(color, renderingMode: .alwaysOriginal)
            }
            var configuration = UIButton.Configuration.plain()
            configuration.title = action.title
            configuration.image = image
            configuration.baseForegroundColor = .label
            entry.button.configuration = configuration
            entry.button.accessibilityIdentifier = action.identifier
            entry.button.accessibilityLabel = action.label
            entry.button.accessibilityValue = action.value
            var traits = UIAccessibilityTraits.button
            if action.isSelected { traits.insert(.selected) }
            if !action.isEnabled { traits.insert(.notEnabled) }
            entry.button.accessibilityTraits = traits
            entry.button.isSelected = action.isSelected
            entry.button.isEnabled = action.isEnabled
            entry.item.title = action.title ?? ""
            entry.item.image = image
            entry.item.label = action.label
            entry.item.paletteLabel = action.label
            entry.item.toolTip = action.label
            entry.item.isEnabled = action.isEnabled
            entry.item.itemMenuFormRepresentation = UIAction(title: action.label, image: image,
                attributes: action.isEnabled ? [] : .disabled, state: action.isSelected ? .on : .off) { [weak self] _ in
                self?.performAction(identifier: action.identifier)
            }
        }

        private func actionContext(item: NSToolbarItem) -> MacToolbarActionContext? {
            guard let window = self.bridgeView?.window, window.windowScene === self.scene,
                  let root = window.rootViewController else { return nil }
            guard !hasCoveringPresentation(root) else { return nil }
            return MacToolbarActionContext(item: item, presenter: root)
        }

        private func performAction(identifier: String, sourceItem: NSToolbarItem? = nil) {
            guard let action = self.actions[identifier], action.isEnabled,
                  let item = sourceItem ?? self.items[identifier]?.item,
                  let context = self.actionContext(item: item) else { return }
            action.perform(context)
        }

        @objc private func searchChanged(_ field: UISearchTextField) {
            guard let search = self.configuration.search, let item = self.searchItem,
                  self.actionContext(item: item) != nil else {
                field.text = self.configuration.search?.text
                return
            }
            search.onChange(field.text ?? "")
        }

        @objc private func activationChanged(_ notification: Notification) { self.scheduleSearchFocus() }

        private func scheduleSearchFocus() {
            DispatchQueue.main.async { [weak self] in self?.focusSearchIfPossible(consumingRequest: true) }
        }

        private func focusSearchIfPossible(consumingRequest: Bool) {
            guard let search = self.configuration.search, let item = self.searchItem,
                  self.searchField.window != nil,
                  let window = self.bridgeView?.window, window.isKeyWindow,
                  window.windowScene?.activationState == .foregroundActive,
                  self.actionContext(item: item) != nil else { return }
            if consumingRequest {
                guard let request = search.focusRequest, request != self.consumedSearchFocusRequest else { return }
                guard self.searchField.becomeFirstResponder(), self.searchField.isFirstResponder else { return }
                self.consumedSearchFocusRequest = request
                search.onFocusRequestHandled()
            } else {
                _ = self.searchField.becomeFirstResponder()
            }
        }

        func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { self.identifiers }
        func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { self.identifiers }
        func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
            if identifier == self.sidebarIdentifier { return self.sidebarItem }
            if identifier == self.titleIdentifier { return self.titleItem }
            if identifier == self.searchIdentifier { return self.searchItem }
            if let group = self.groups[identifier.rawValue] { return group.item }
            return self.items[identifier.rawValue]?.item
        }
    }

    @MainActor
    private final class GroupEntry: NSObject {
        let identifiers: [String]
        private(set) var item: NSToolbarItemGroup!
        private var presentation: [MacToolbarAction] = []
        private let activate: (String, NSToolbarItem) -> Void

        init(group: MacToolbarGroup, activate: @escaping (String, NSToolbarItem) -> Void) {
            self.identifiers = group.actions.map(\.identifier)
            self.activate = activate
            super.init()
            self.item = NSToolbarItemGroup(
                itemIdentifier: NSToolbarItem.Identifier(group.identifier),
                titles: group.actions.map { $0.title ?? "" },
                selectionMode: .momentary, labels: nil,
                target: self, action: #selector(self.pressed(_:))
            )
            self.item.controlRepresentation = .expanded
            self.item.isBordered = true
            self.item.autovalidates = false
            self.item.visibilityPriority = .high
            self.update(actions: group.actions)
        }

        func update(actions: [MacToolbarAction]) {
            guard actions.count == self.item.subitems.count else { return }
            let changed = actions.indices.filter { index in
                guard self.presentation.indices.contains(index) else { return true }
                let previous = self.presentation[index], next = actions[index]
                return previous.title != next.title || previous.symbol != next.symbol
                    || previous.symbolColor != next.symbolColor || previous.label != next.label
                    || previous.isEnabled != next.isEnabled || previous.isSelected != next.isSelected
            }
            guard !changed.isEmpty else { return }
            // Keep the factory's system representation and generated children stable.
            for index in changed {
                let action = actions[index], child = self.item.subitems[index]
                if child.title != action.title ?? "" { child.title = action.title ?? "" }
                var image = action.symbol.isEmpty ? nil : UIImage(systemName: action.symbol)
                if let color = action.symbolColor { image = image?.withTintColor(color, renderingMode: .alwaysOriginal) }
                child.image = image
                child.label = action.label
                child.paletteLabel = action.label
                child.toolTip = action.label
                child.isEnabled = action.isEnabled
                child.autovalidates = false
                child.itemMenuFormRepresentation = UIAction(title: action.label, image: image,
                    attributes: action.isEnabled ? [] : .disabled) { [weak self, weak child] _ in
                    guard let child else { return }
                    self?.activate(action.identifier, child)
                }
            }
            self.presentation = actions
            self.item.label = actions.map(\.label).joined(separator: ", ")
            self.item.paletteLabel = self.item.label
            self.item.itemMenuFormRepresentation = UIMenu(title: self.item.label,
                children: self.item.subitems.compactMap(\.itemMenuFormRepresentation))
        }

        @objc private func pressed(_ sender: Any?) {
            let index = self.item.selectedIndex
            guard self.identifiers.indices.contains(index) else { return }
            self.activate(self.identifiers[index], self.item.subitems[index])
        }
    }

    @MainActor
    private final class ActionEntry: NSObject {
        let button: UIButton
        let item: NSUIViewToolbarItem
        private let activate: () -> Void

        init(action: MacToolbarAction, activate: @escaping () -> Void) {
            self.activate = activate
            self.button = UIButton(type: .system)
            self.button.accessibilityIdentifier = action.identifier
            self.item = NSUIViewToolbarItem(itemIdentifier: NSToolbarItem.Identifier(action.identifier), uiView: self.button)
            super.init()
            self.button.addTarget(self, action: #selector(self.pressed(_:)), for: .primaryActionTriggered)
            self.item.isBordered = true
            self.item.autovalidates = false
        }

        @objc private func pressed(_ sender: Any?) { self.activate() }
    }

    /// Catalyst has no NSSearchToolbarItem. On macOS 26+ the bordered toolbar item draws
    /// the native glass platter, as Finder's search does, so the field itself stays
    /// borderless at the 36-point toolbar button height (divided by Catalyst's 77% scale).
    private final class ToolbarSearchField: UISearchTextField {
        private static let height: CGFloat = 36 / 0.77
        private static let horizontalInset: CGFloat = 12 / 0.77
        private static let iconToTextSpacing: CGFloat = 6 / 0.77
        static var usesToolbarPlatter: Bool {
            if #available(iOS 26.0, *) { return true }
            return false
        }
        private let rootSizing = ToolbarRootSizing()
        var onWindowAvailable: (() -> Void)?

        override init(frame: CGRect) {
            super.init(frame: frame)
            if Self.usesToolbarPlatter {
                self.borderStyle = .none
                self.backgroundColor = .clear
            }
        }

        required init?(coder: NSCoder) {
            fatalError("ToolbarSearchField is created in code")
        }

        /// The platter takes the field's UIKit width as Mac points and centres the 77%-scaled
        /// field in it, so the content reaches out to the platter's own edges.
        private var platterOverhang: CGFloat { self.bounds.width * (1 / 0.77 - 1) / 2 }

        override func leftViewRect(forBounds bounds: CGRect) -> CGRect {
            let rect = super.leftViewRect(forBounds: bounds)
            guard Self.usesToolbarPlatter else { return rect }
            return rect.offsetBy(dx: Self.horizontalInset - self.platterOverhang - rect.minX, dy: 0)
        }

        override func textRect(forBounds bounds: CGRect) -> CGRect {
            let rect = super.textRect(forBounds: bounds)
            guard Self.usesToolbarPlatter else { return rect }
            let minX = self.leftViewRect(forBounds: bounds).maxX + Self.iconToTextSpacing
            let maxX = bounds.maxX + self.platterOverhang - Self.horizontalInset
            return CGRect(x: minX, y: rect.minY, width: max(0, maxX - minX), height: rect.height)
        }

        override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
            guard Self.usesToolbarPlatter else { return super.point(inside: point, with: event) }
            return self.bounds.insetBy(dx: -self.platterOverhang, dy: 0).contains(point)
        }

        override func editingRect(forBounds bounds: CGRect) -> CGRect { self.textRect(forBounds: bounds) }
        override func placeholderRect(forBounds bounds: CGRect) -> CGRect { self.textRect(forBounds: bounds) }

        /// Without the platter (before macOS 26) the field draws its own bordered shape at
        /// the system field height, matching that era's smaller toolbar controls.
        private static let borderedHeight: CGFloat = {
            let field = UISearchTextField()
            field.font = UIFont.preferredFont(forTextStyle: .body)
            return field.sizeThatFits(UIView.layoutFittingCompressedSize).height
        }()

        override var intrinsicContentSize: CGSize {
            // Do not ask UITextField's intrinsic implementation to call back into
            // sizeThatFits; both sizing paths must return this same toolbar size.
            CGSize(width: 240, height: Self.usesToolbarPlatter ? Self.height : Self.borderedHeight)
        }
        override func sizeThatFits(_ size: CGSize) -> CGSize { self.intrinsicContentSize }
        func updateToolbarFittingSize() {
            self.rootSizing.update(view: self, size: self.sizeThatFits(UIView.layoutFittingCompressedSize))
        }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            if self.window != nil { self.onWindowAvailable?() }
        }
    }

    /// NSToolbar must measure the root viewport, not just overflowing child AX frames.
    @MainActor
    private final class ToolbarRootSizing {
        private var widthConstraint: NSLayoutConstraint?
        private var heightConstraint: NSLayoutConstraint?

        func update(view: UIView, size: CGSize) {
            let size = CGSize(width: max(1, size.width), height: max(1, size.height))
            if self.widthConstraint?.constant == size.width, self.heightConstraint?.constant == size.height,
               view.bounds.size == size { return }
            view.translatesAutoresizingMaskIntoConstraints = false
            if self.widthConstraint == nil {
                let width = view.widthAnchor.constraint(equalToConstant: size.width)
                let height = view.heightAnchor.constraint(equalToConstant: size.height)
                NSLayoutConstraint.activate([width, height])
                self.widthConstraint = width
                self.heightConstraint = height
            } else {
                self.widthConstraint?.constant = size.width
                self.heightConstraint?.constant = size.height
            }
            if view.bounds.size != size {
                view.frame = CGRect(origin: view.frame.origin, size: size)
            }
            view.setNeedsLayout()
            view.layoutIfNeeded()
        }
    }
}
#endif
