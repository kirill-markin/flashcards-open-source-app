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

@MainActor
func isActiveKeyboardWindow(_ window: UIWindow?) -> Bool {
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

/// Probe the responder directly to avoid expensive window view-tree walks.
@MainActor
func keyboardFirstResponderView(in view: UIView) -> UIView? {
    FirstResponderProbe.responder = nil
    defer { FirstResponderProbe.responder = nil }
    UIApplication.shared.sendAction(#selector(UIResponder.nibomoReportFirstResponder(_:)), to: nil, from: nil, for: nil)
    guard let responder = FirstResponderProbe.responder as? UIView, responder.isFirstResponder,
          responder.isDescendant(of: view) else { return nil }
    return responder
}

@MainActor
func hasCoveringPresentation(_ controller: UIViewController) -> Bool {
    controller.presentedViewController != nil || controller.children.contains(where: hasCoveringPresentation)
}

#if targetEnvironment(macCatalyst)
@MainActor
private func hasEditableResponder(in window: UIWindow) -> Bool {
    guard let responder = keyboardFirstResponderView(in: window) else { return false }
    return responder is UIKeyInput || responder is UITextInput
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
              let responder = keyboardFirstResponderView(in: window),
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
            && (self.isFirstResponder || self.viewIfLoaded.map { keyboardFirstResponderView(in: $0) != nil } == true)
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
