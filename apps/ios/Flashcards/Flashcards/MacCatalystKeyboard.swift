import SwiftUI
import UIKit

struct ComposerKeyboardModifier: ViewModifier {
    let isEnabled: Bool
    let onDismiss: () -> Void

    func body(content: Content) -> some View {
        #if targetEnvironment(macCatalyst)
        content.background {
            ComposerEscapeCommandObserver(isEnabled: self.isEnabled, onDismiss: self.onDismiss)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        #else
        content
        #endif
    }
}

struct CardEditorKeyboardModifier: ViewModifier {
    let isEnabled: Bool
    let isSummaryVisible: Bool
    let onCancel: () -> Void
    let onSave: () -> Void

    func body(content: Content) -> some View {
        #if targetEnvironment(macCatalyst)
        CardEditorKeyboardHost(
            content: content,
            isEnabled: self.isEnabled,
            isSummaryVisible: self.isSummaryVisible,
            onCancel: self.onCancel,
            onSave: self.onSave
        )
        #else
        content
        #endif
    }
}

#if targetEnvironment(macCatalyst)
enum StudyKeyboardFocusRequest: Equatable {
    case automatic(UUID)
    case study(UUID)
}

@MainActor
private func isActiveKeyboardWindow(_ window: UIWindow?) -> Bool {
    window?.isKeyWindow == true && window?.windowScene?.activationState == .foregroundActive
}

@MainActor
private enum FirstResponderProbe {
    static weak var responder: UIResponder?
}

private extension UIResponder {
    @objc func nibomoReportFirstResponder(_ sender: Any?) {
        FirstResponderProbe.responder = self
    }
}

/// The first responder inside `view`. A nil-targeted action reaches it directly; walking
/// the window's view tree instead cost seconds while the companion laid out.
@MainActor
private func firstResponderView(in view: UIView) -> UIView? {
    FirstResponderProbe.responder = nil
    defer { FirstResponderProbe.responder = nil }
    UIApplication.shared.sendAction(#selector(UIResponder.nibomoReportFirstResponder(_:)), to: nil, from: nil, for: nil)
    guard let responder = FirstResponderProbe.responder as? UIView, responder.isFirstResponder,
          responder.isDescendant(of: view) else { return nil }
    return responder
}

@MainActor
private func hasEditableResponder(in window: UIWindow) -> Bool {
    guard let responder = firstResponderView(in: window) else { return false }
    return responder is UIKeyInput || responder is UITextInput
}

@MainActor
private func hasCoveringPresentation(_ controller: UIViewController) -> Bool {
    controller.presentedViewController != nil || controller.children.contains(where: hasCoveringPresentation)
}

private struct ComposerEscapeCommandObserver: UIViewRepresentable {
    let isEnabled: Bool
    let onDismiss: () -> Void

    func makeUIView(context: Context) -> ComposerEscapeCommandView {
        let view = ComposerEscapeCommandView()
        view.isUserInteractionEnabled = false
        view.isAccessibilityElement = false
        view.accessibilityElementsHidden = true
        return view
    }

    func updateUIView(_ view: ComposerEscapeCommandView, context: Context) {
        view.isEnabled = self.isEnabled
        view.onDismiss = self.onDismiss
        view.refreshCommand()
    }

    static func dismantleUIView(_ view: ComposerEscapeCommandView, coordinator: Void) {
        view.isEnabled = false
        view.detach()
        view.onDismiss = nil
    }
}

private final class ComposerEscapeCommandView: UIView {
    var isEnabled = false
    var onDismiss: (() -> Void)?
    private weak var commandController: UIViewController?
    private let commandIdentifier = UUID().uuidString
    private static var commandOwners: [String: CommandOwner] = [:]

    private final class CommandOwner {
        weak var view: ComposerEscapeCommandView?
        init(_ view: ComposerEscapeCommandView) { self.view = view }
    }
    private lazy var escapeCommand: UIKeyCommand = {
        let command = UIKeyCommand(
            title: "", image: nil, action: #selector(UIViewController.nibomoDismissComposerEditing(_:)),
            input: UIKeyCommand.inputEscape, modifierFlags: [], propertyList: self.commandIdentifier
        )
        command.wantsPriorityOverSystemBehavior = true
        return command
    }()

    override func didMoveToWindow() {
        super.didMoveToWindow()
        self.detach()
        guard let window = self.window else { return }
        for name in [UITextView.textDidBeginEditingNotification, UITextView.textDidEndEditingNotification,
                     UITextView.textDidChangeNotification, UITextField.textDidChangeNotification,
                     UITextField.textDidBeginEditingNotification, UITextField.textDidEndEditingNotification,
                     UIWindow.didBecomeKeyNotification, UIWindow.didResignKeyNotification] {
            NotificationCenter.default.addObserver(self, selector: #selector(self.editingChanged), name: name, object: nil)
        }
        if let scene = window.windowScene {
            NotificationCenter.default.addObserver(self, selector: #selector(self.editingChanged), name: UIScene.didActivateNotification, object: scene)
        }
        self.refreshCommand()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        self.refreshCommand()
    }

    func detach() {
        NotificationCenter.default.removeObserver(self)
        self.commandController?.removeKeyCommand(self.escapeCommand)
        self.commandController = nil
        Self.commandOwners[self.commandIdentifier] = nil
    }

    @objc private func editingChanged() {
        self.refreshCommand()
        DispatchQueue.main.async { [weak self] in self?.refreshCommand() }
    }

    func refreshCommand() {
        let controller = self.eligibleController()
        guard self.commandController !== controller else { return }
        self.commandController?.removeKeyCommand(self.escapeCommand)
        self.commandController = controller
        if let controller {
            Self.commandOwners[self.commandIdentifier] = CommandOwner(self)
            controller.addKeyCommand(self.escapeCommand)
        }
    }

    private func eligibleController() -> UIViewController? {
        guard self.isEnabled, let window = self.window, isActiveKeyboardWindow(window),
              let responder = firstResponderView(in: window),
              responder is UITextInput || responder is UIKeyInput,
              (responder as? UITextInput)?.markedTextRange == nil,
              self.convert(self.bounds, to: window).intersects(responder.convert(responder.bounds, to: window)) else { return nil }
        var nextResponder = self.next
        while let responder = nextResponder {
            if let controller = responder as? UIViewController {
                return hasCoveringPresentation(controller) ? nil : controller
            }
            nextResponder = responder.next
        }
        return nil
    }

    static func perform(_ command: UICommand) {
        guard let identifier = command.propertyList as? String,
              let view = self.commandOwners[identifier]?.view,
              view.eligibleController() != nil else { return }
        view.onDismiss?()
    }
}

private extension UIViewController {
    @objc func nibomoDismissComposerEditing(_ command: UICommand) {
        // Use the command's stable property list to reach its owning field.
        ComposerEscapeCommandView.perform(command)
    }

    @objc func nibomoStudySidebarInput(_ command: UIKeyCommand) {
        StudyKeyboardView.performSidebarCommand(command)
    }
}

struct MacStudyKeyboardReceiver: UIViewRepresentable {
    let isEnabled: Bool
    let isStudyActive: Bool
    let focusRequest: StudyKeyboardFocusRequest?
    let onInput: (String) -> Bool

    func makeUIView(context: Context) -> StudyKeyboardView {
        let view = StudyKeyboardView()
        view.backgroundColor = .clear
        view.isAccessibilityElement = false
        view.accessibilityElementsHidden = true
        return view
    }

    func updateUIView(_ view: StudyKeyboardView, context: Context) {
        view.isEnabled = self.isEnabled
        view.isStudyActive = self.isStudyActive
        view.onInput = self.onInput
        view.focusRequest = self.focusRequest
        if self.isStudyActive == false && view.isFirstResponder { view.resignFirstResponder() }
        view.scheduleFocusRequest()
        view.refreshSidebarCommands()
    }

    static func dismantleUIView(_ view: StudyKeyboardView, coordinator: Void) {
        view.isEnabled = false
        view.refreshSidebarCommands()
        view.onInput = nil
        view.focusRequest = nil
        NotificationCenter.default.removeObserver(view)
        if view.isFirstResponder { view.resignFirstResponder() }
    }
}

final class StudyKeyboardView: UIView {
    var isEnabled: Bool = false
    var isStudyActive: Bool = false
    var focusRequest: StudyKeyboardFocusRequest?
    var onInput: ((String) -> Bool)?
    private var consumedFocusRequest: StudyKeyboardFocusRequest?

    override var canBecomeFirstResponder: Bool { true }
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool { false }
    private var canHandleInput: Bool {
        guard self.isFirstResponder, self.isEnabled, isActiveKeyboardWindow(self.window) else { return false }
        // Native keyboard focus owns activation and navigation of visible controls.
        // A hidden shortcut responder must never override a focused button's Space.
        if let focusedItem = UIFocusSystem.focusSystem(for: self)?.focusedItem,
           focusedItem as AnyObject !== self { return false }
        return true
    }
    override var keyCommands: [UIKeyCommand]? {
        guard self.canHandleInput else { return [] }
        let commands = [" ", "\r", "\u{3}", "1", "2", "3", "4"].map {
            UIKeyCommand(input: $0, modifierFlags: [], action: #selector(self.studyInput(_:)))
        }
        let keypadEnterCommands = ["\r", "\u{3}"].map {
            UIKeyCommand(input: $0, modifierFlags: .numericPad, action: #selector(self.studyInput(_:)))
        }
        let studyCommands = commands + keypadEnterCommands
        // Native focus navigation reserves Space. Only the active study responder
        // may override it; focused editors and chat keep their normal key input.
        for command in studyCommands where command.input == " " || command.input == "\r" || command.input == "\u{3}" {
            command.wantsPriorityOverSystemBehavior = true
        }
        return studyCommands
    }
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(self.studyInput(_:)) { return self.canHandleInput }
        return super.canPerformAction(action, withSender: sender)
    }
    override func didMoveToWindow() {
        super.didMoveToWindow()
        NotificationCenter.default.removeObserver(self)
        if let window = self.window {
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(self.keyboardWindowBecameKey),
                name: UIWindow.didBecomeKeyNotification,
                object: window
            )
        }
        self.scheduleFocusRequest()
        self.refreshSidebarCommands()
    }

    // A clicked sidebar row keeps native keyboard focus, so arrow keys still move through the
    // sidebar, but this receiver then leaves the key path. While study is active the sidebar
    // column's own responder chain offers the same keys; editors and the detail never see them.
    private weak var sidebarCommandController: UIViewController?
    private let sidebarCommandIdentifier = UUID().uuidString
    private static var sidebarCommandOwners: [String: SidebarCommandOwner] = [:]

    private final class SidebarCommandOwner {
        weak var view: StudyKeyboardView?
        init(_ view: StudyKeyboardView) { self.view = view }
    }

    private lazy var sidebarCommands: [UIKeyCommand] = {
        let plain = [" ", "\r", "\u{3}", "1", "2", "3", "4"].map { ($0, UIKeyModifierFlags()) }
        let keypad = ["\r", "\u{3}"].map { ($0, UIKeyModifierFlags.numericPad) }
        return (plain + keypad).map { input, modifiers in
            let command = UIKeyCommand(
                title: "", image: nil, action: #selector(UIViewController.nibomoStudySidebarInput(_:)),
                input: input, modifierFlags: modifiers, propertyList: self.sidebarCommandIdentifier
            )
            // Space/Return otherwise activate the focused sidebar row, which is already selected.
            command.wantsPriorityOverSystemBehavior = input == " " || input == "\r" || input == "\u{3}"
            return command
        }
    }()

    func refreshSidebarCommands() {
        let controller = self.isEnabled && self.isStudyActive ? self.sidebarColumnController() : nil
        guard self.sidebarCommandController !== controller else { return }
        if let previous = self.sidebarCommandController {
            self.sidebarCommands.forEach(previous.removeKeyCommand)
        }
        self.sidebarCommandController = controller
        Self.sidebarCommandOwners[self.sidebarCommandIdentifier] = controller == nil ? nil : SidebarCommandOwner(self)
        if let controller {
            self.sidebarCommands.forEach(controller.addKeyCommand)
        }
    }

    private func sidebarColumnController() -> UIViewController? {
        func splitController(in controller: UIViewController) -> UISplitViewController? {
            if let split = controller as? UISplitViewController { return split }
            return controller.children.lazy.compactMap { splitController(in: $0) }.first
        }
        guard let root = self.window?.rootViewController, let split = splitController(in: root),
              let sidebar = split.viewController(for: .primary) ?? split.viewControllers.first,
              let sidebarView = sidebar.viewIfLoaded else { return nil }
        // A collapsed split can host the study column itself; its editors must keep Space.
        return self.isDescendant(of: sidebarView) ? nil : sidebar
    }

    static func performSidebarCommand(_ command: UIKeyCommand) {
        guard let identifier = command.propertyList as? String,
              let view = self.sidebarCommandOwners[identifier]?.view,
              view.isEnabled, view.isStudyActive, let input = command.input,
              let window = view.window, isActiveKeyboardWindow(window),
              let root = window.rootViewController, hasCoveringPresentation(root) == false,
              hasEditableResponder(in: window) == false else { return }
        let allowedModifiers: UIKeyModifierFlags = input == "\r" || input == "\u{3}" ? .numericPad : []
        guard command.modifierFlags.subtracting(allowedModifiers).isEmpty else { return }
        _ = view.onInput?(input)
    }
    func scheduleFocusRequest() {
        self.applyFocusRequest()
        DispatchQueue.main.async { [weak self] in self?.applyFocusRequest() }
    }
    @objc private func keyboardWindowBecameKey(_ notification: Notification) {
        self.scheduleFocusRequest()
    }
    func applyFocusRequest() {
        guard let request = self.focusRequest, request != self.consumedFocusRequest,
              let window = self.window else { return }
        guard self.isStudyActive, self.isEnabled, isActiveKeyboardWindow(window),
              let rootController = window.rootViewController,
              hasCoveringPresentation(rootController) == false else { return }
        if case .automatic = request {
            guard hasEditableResponder(in: window) == false else { return }
        }
        if case .study = request, hasEditableResponder(in: window) {
            guard firstResponderView(in: window) is ReviewSelectionTextView else { return }
        }
        guard self.becomeFirstResponder(), self.isFirstResponder else { return }
        self.consumedFocusRequest = request
    }
    @objc private func studyInput(_ command: UIKeyCommand) {
        guard self.canHandleInput, let input = command.input else { return }
        let allowedModifiers: UIKeyModifierFlags = input == "\r" || input == "\u{3}" ? .numericPad : []
        guard command.modifierFlags.subtracting(allowedModifiers).isEmpty else { return }
        _ = self.onInput?(input)
    }
}

private struct CardEditorKeyboardHost<Content: View>: UIViewControllerRepresentable {
    let content: Content
    let isEnabled: Bool
    let isSummaryVisible: Bool
    let onCancel: () -> Void
    let onSave: () -> Void

    func makeUIViewController(context: Context) -> CardEditorKeyboardController {
        let controller = CardEditorKeyboardController(rootView: AnyView(self.content.environment(\.self, context.environment)))
        self.updateUIViewController(controller, context: context)
        return controller
    }
    func updateUIViewController(_ controller: CardEditorKeyboardController, context: Context) {
        let returnedToSummary = controller.isSummaryVisible == false && self.isSummaryVisible
        controller.rootView = AnyView(self.content.environment(\.self, context.environment))
        controller.isEnabled = self.isEnabled
        controller.isSummaryVisible = self.isSummaryVisible
        controller.onCancel = self.onCancel
        controller.onSave = self.onSave
        if returnedToSummary {
            DispatchQueue.main.async { [weak controller] in controller?.focusSummary() }
        }
    }
    static func dismantleUIViewController(_ controller: CardEditorKeyboardController, coordinator: Void) {
        controller.isEnabled = false
        controller.onCancel = nil
        controller.onSave = nil
        if controller.isFirstResponder { controller.resignFirstResponder() }
    }
}

private final class CardEditorKeyboardController: UIHostingController<AnyView> {
    var isEnabled: Bool = false
    var isSummaryVisible: Bool = false
    var onCancel: (() -> Void)?
    var onSave: (() -> Void)?
    private var hasAppeared: Bool = false

    override var canBecomeFirstResponder: Bool { true }
    private var canHandleInput: Bool {
        self.isEnabled && isActiveKeyboardWindow(self.viewIfLoaded?.window)
            && hasCoveringPresentation(self) == false
            && (self.isFirstResponder || self.viewIfLoaded.map { firstResponderView(in: $0) != nil } == true)
    }
    override var keyCommands: [UIKeyCommand]? {
        let inheritedCommands = super.keyCommands ?? []
        guard self.canHandleInput else { return inheritedCommands }
        return inheritedCommands + [
            UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(self.cancelEditor(_:))),
            UIKeyCommand(input: "s", modifierFlags: .command, action: #selector(self.saveEditor(_:)))
        ]
    }
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(self.cancelEditor(_:)) || action == #selector(self.saveEditor(_:)) {
            return self.canHandleInput
        }
        return super.canPerformAction(action, withSender: sender)
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard self.hasAppeared == false else { return }
        self.hasAppeared = true
        self.focusSummary()
    }
    func focusSummary() {
        guard self.isEnabled, self.isSummaryVisible, let window = self.viewIfLoaded?.window,
              isActiveKeyboardWindow(window), hasCoveringPresentation(self) == false,
              hasEditableResponder(in: window) == false else { return }
        guard self.becomeFirstResponder(), self.isFirstResponder else { return }
    }
    @objc private func cancelEditor(_ command: UIKeyCommand) {
        guard self.canHandleInput else { return }
        self.onCancel?()
    }
    @objc private func saveEditor(_ command: UIKeyCommand) {
        guard self.canHandleInput else { return }
        self.onSave?()
    }
}
#endif
