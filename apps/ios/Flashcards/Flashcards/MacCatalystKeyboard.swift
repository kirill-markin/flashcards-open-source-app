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
enum StudyKeyboardFocusRequest: Equatable {
    case automatic(UUID)
    case study(UUID)
}

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

struct MacStudyKeyboardReceiver: UIViewRepresentable {
    let isEnabled: Bool
    let isStudyActive: Bool
    let focusRequest: StudyKeyboardFocusRequest?
    let onInput: (String) -> Bool

    func makeUIView(context: Context) -> StudyKeyboardView {
        let view = StudyKeyboardView()
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ view: StudyKeyboardView, context: Context) {
        view.isEnabled = self.isEnabled
        view.isStudyActive = self.isStudyActive
        view.onInput = self.onInput
        view.focusRequest = self.focusRequest
        if self.isStudyActive == false && view.isFirstResponder { view.resignFirstResponder() }
        view.scheduleFocusRequest()
    }

    static func dismantleUIView(_ view: StudyKeyboardView, coordinator: Void) {
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
        self.isFirstResponder && self.isEnabled && isActiveKeyboardWindow(self.window)
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
        // Return must bypass retained system default actions when study owns the responder.
        for command in studyCommands where command.input == "\r" || command.input == "\u{3}" {
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
