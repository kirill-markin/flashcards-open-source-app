import SwiftUI
import UIKit

struct AIChatComposerKeyboardObserver: UIViewRepresentable {
    let isEnabled: Bool
    let canSend: () -> Bool
    let onSend: () -> Void
    #if targetEnvironment(macCatalyst)
    let macReturnKeyOwner: MacComposerReturnKeyOwner
    #endif

    func makeUIView(context: Context) -> AIChatComposerKeyboardCommandView {
        let view = AIChatComposerKeyboardCommandView()
        #if targetEnvironment(macCatalyst)
        self.macReturnKeyOwner.attach(view)
        #endif
        view.isUserInteractionEnabled = false
        view.isAccessibilityElement = false
        view.accessibilityElementsHidden = true
        return view
    }

    func updateUIView(_ view: AIChatComposerKeyboardCommandView, context: Context) {
        view.isEnabled = self.isEnabled
        view.canSend = self.canSend
        view.onSend = self.onSend
        #if targetEnvironment(macCatalyst)
        self.macReturnKeyOwner.attach(view)
        #endif
        view.refreshCommands()
    }

    static func dismantleUIView(_ view: AIChatComposerKeyboardCommandView, coordinator: Void) {
        view.isEnabled = false
        view.detach()
        #if targetEnvironment(macCatalyst)
        view.macReturnKeyOwner?.detach(view)
        view.macReturnKeyOwner = nil
        #endif
        view.canSend = nil
        view.onSend = nil
    }
}

#if targetEnvironment(macCatalyst)
@MainActor
final class MacComposerReturnKeyOwner {
    private weak var commandView: AIChatComposerKeyboardCommandView?
    private weak var responder: UIView?
    private var key: String?

    fileprivate func attach(_ view: AIChatComposerKeyboardCommandView) {
        if self.commandView !== view { self.cancel() }
        self.commandView = view
        view.macReturnKeyOwner = self
    }

    fileprivate func detach(_ view: AIChatComposerKeyboardCommandView) {
        guard self.commandView === view else { return }
        self.cancel()
        self.commandView = nil
    }

    /// Returns whether Shift- or Option-Return was consumed as a plain newline.
    func handlePressBegan(_ key: UIKey) -> Bool {
        guard ["\r", "\u{3}"].contains(key.charactersIgnoringModifiers) else { return false }
        self.cancel()
        guard let responder = self.commandView?.macReturnResponder,
              let textInput = responder as? UITextInput else { return false }
        let modifiers = key.modifierFlags.intersection([.shift, .alternate, .control, .command])
        guard modifiers == .shift || modifiers == .alternate else { return false }
        self.key = key.charactersIgnoringModifiers
        self.responder = responder
        textInput.insertText("\n")
        return true
    }

    /// Returns whether the release belongs to a consumed press, so the text system never sees half of it.
    func handlePressEnded(_ key: UIKey) -> Bool {
        guard self.key == key.charactersIgnoringModifiers else { return false }
        defer { self.cancel() }
        guard let responder = self.responder,
              self.commandView?.macReturnResponder === responder else { return false }
        return true
    }

    fileprivate func cancel() {
        self.key = nil
        self.responder = nil
    }
}
#endif

@MainActor
private func makeComposerReturnKeyCommands(
    modifierFlags: [UIKeyModifierFlags],
    action: Selector,
    identifier: String
) -> [UIKeyCommand] {
    modifierFlags.flatMap { flags in
        [flags, flags.union(.numericPad)].flatMap { flags in
            ["\r", "\u{3}"].map { input in
                let command = UIKeyCommand(
                    title: "", image: nil, action: action,
                    input: input, modifierFlags: flags, propertyList: identifier
                )
                command.wantsPriorityOverSystemBehavior = true
                return command
            }
        }
    }
}

final class AIChatComposerKeyboardCommandView: UIView {
    var isEnabled = false
    var canSend: (() -> Bool)?
    var onSend: (() -> Void)?
    private weak var commandController: UIViewController?
    #if targetEnvironment(macCatalyst)
    fileprivate weak var macReturnKeyOwner: MacComposerReturnKeyOwner?

    fileprivate var macReturnResponder: UIView? {
        guard self.eligibleController() != nil, let window = self.window else { return nil }
        return keyboardFirstResponderView(in: window)
    }
    #endif
    private let commandIdentifier = UUID().uuidString
    private static var commandOwners: [String: CommandOwner] = [:]

    private final class CommandOwner {
        weak var view: AIChatComposerKeyboardCommandView?
        init(_ view: AIChatComposerKeyboardCommandView) { self.view = view }
    }

    private lazy var returnCommands: [UIKeyCommand] = makeComposerReturnKeyCommands(
        modifierFlags: [UIKeyModifierFlags()],
        action: #selector(UIViewController.nibomoSendComposerMessage(_:)),
        identifier: self.commandIdentifier
    )
    private lazy var lineBreakCommands: [UIKeyCommand] = makeComposerReturnKeyCommands(
        modifierFlags: [.shift, .alternate],
        action: #selector(UIViewController.nibomoInsertComposerLineBreak(_:)),
        identifier: self.commandIdentifier
    )

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
            for name in [UIScene.didActivateNotification, UIScene.willDeactivateNotification] {
                NotificationCenter.default.addObserver(self, selector: #selector(self.editingChanged), name: name, object: scene)
            }
        }
        self.refreshCommands()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        self.refreshCommands()
    }

    func detach() {
        NotificationCenter.default.removeObserver(self)
        #if targetEnvironment(macCatalyst)
        self.macReturnKeyOwner?.cancel()
        #endif
        self.removeCommands()
        self.commandController = nil
        Self.commandOwners[self.commandIdentifier] = nil
    }

    @objc private func editingChanged() {
        self.refreshCommands()
        DispatchQueue.main.async { [weak self] in self?.refreshCommands() }
    }

    func refreshCommands() {
        #if targetEnvironment(macCatalyst)
        if self.eligibleController() == nil { self.macReturnKeyOwner?.cancel() }
        #endif
        let controller = self.eligibleController()
        guard self.commandController !== controller else { return }
        self.removeCommands()
        self.commandController = controller
        Self.commandOwners[self.commandIdentifier] = nil
        if let controller {
            Self.commandOwners[self.commandIdentifier] = CommandOwner(self)
            #if targetEnvironment(macCatalyst)
            for command in self.returnCommands {
                controller.addKeyCommand(command)
            }
            #else
            for command in self.returnCommands + self.lineBreakCommands {
                controller.addKeyCommand(command)
            }
            #endif
        }
    }

    private func removeCommands() {
        for command in self.returnCommands + self.lineBreakCommands {
            self.commandController?.removeKeyCommand(command)
        }
    }

    private func eligibleController() -> UIViewController? {
        guard self.isEnabled, let window = self.window, isActiveKeyboardWindow(window),
              let responder = keyboardFirstResponderView(in: window),
              let textInput = responder as? UITextInput,
              textInput.markedTextRange == nil,
              self.convert(self.bounds, to: window).intersects(responder.convert(responder.bounds, to: window)) else { return nil }
        var nextResponder = self.next
        while let owner = nextResponder {
            if let controller = owner as? UIViewController {
                guard responder.isDescendant(of: controller.view),
                      hasCoveringPresentation(controller) == false else { return nil }
                return controller
            }
            nextResponder = owner.next
        }
        return nil
    }

    static func sendMessage(_ command: UICommand) {
        guard let identifier = command.propertyList as? String,
              let view = self.commandOwners[identifier]?.view,
              view.eligibleController() != nil,
              view.canSend?() == true else { return }
        view.onSend?()
    }

    static func insertLineBreak(_ command: UICommand) {
        guard let identifier = command.propertyList as? String,
              let view = self.commandOwners[identifier]?.view,
              view.eligibleController() != nil,
              let window = view.window,
              let textInput = keyboardFirstResponderView(in: window) as? UITextInput else { return }
        // Mac text input can insert U+2028 instead of the draft's plain newline.
        textInput.insertText("\n")
    }
}

private extension UIViewController {
    @objc func nibomoSendComposerMessage(_ command: UICommand) {
        AIChatComposerKeyboardCommandView.sendMessage(command)
    }

    @objc func nibomoInsertComposerLineBreak(_ command: UICommand) {
        AIChatComposerKeyboardCommandView.insertLineBreak(command)
    }
}
