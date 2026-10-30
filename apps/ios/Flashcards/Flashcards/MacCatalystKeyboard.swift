import SwiftUI
import UIKit

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
@MainActor
private func isActiveKeyboardWindow(_ window: UIWindow?) -> Bool {
    window?.isKeyWindow == true && window?.windowScene?.activationState == .foregroundActive
}

@MainActor
private func firstResponderView(in view: UIView) -> UIView? {
    if view.isFirstResponder { return view }
    return view.subviews.lazy.compactMap { firstResponderView(in: $0) }.first
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
