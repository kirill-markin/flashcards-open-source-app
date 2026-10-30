import SwiftUI
import UIKit

/// Hosts the composer so a UIKit ancestor of its text view owns hardware Return.
/// UIKit key commands fire only for hardware keyboards; on-screen Return keeps inserting a new line.
struct AIChatComposerKeyboardHost<Content: View>: UIViewControllerRepresentable {
    let isFocused: Binding<Bool>
    let canSend: () -> Bool
    let onSend: () -> Void
    let content: (FocusState<Bool>.Binding) -> Content

    func makeUIViewController(context: Context) -> AIChatComposerKeyboardController {
        let controller = AIChatComposerKeyboardController(rootView: self.rootView(context: context))
        controller.view.backgroundColor = .clear
        controller.sizingOptions = .intrinsicContentSize
        controller.safeAreaRegions = []
        self.updateUIViewController(controller, context: context)
        return controller
    }

    func updateUIViewController(_ controller: AIChatComposerKeyboardController, context: Context) {
        controller.rootView = self.rootView(context: context)
        controller.canSend = self.canSend
        controller.onSend = self.onSend
    }

    func sizeThatFits(
        _ proposal: ProposedViewSize,
        uiViewController: AIChatComposerKeyboardController,
        context: Context
    ) -> CGSize? {
        uiViewController.sizeThatFits(in: CGSize(
            width: proposal.width ?? .greatestFiniteMagnitude,
            height: .greatestFiniteMagnitude
        ))
    }

    static func dismantleUIViewController(_ controller: AIChatComposerKeyboardController, coordinator: Void) {
        controller.canSend = nil
        controller.onSend = nil
    }

    private func rootView(context: Context) -> AnyView {
        AnyView(
            AIChatComposerFocusBridge(isFocused: self.isFocused, content: self.content)
                .environment(\.self, context.environment)
        )
    }
}

/// A FocusState only tracks text fields rendered in its own hosting graph, so the hosted
/// composer owns one and mirrors it into the chat's plain focus flag.
private struct AIChatComposerFocusBridge<Content: View>: View {
    @Binding var isFocused: Bool
    let content: (FocusState<Bool>.Binding) -> Content
    @FocusState private var isTextFieldFocused: Bool

    var body: some View {
        self.content(self.$isTextFieldFocused)
            .onAppear {
                self.isTextFieldFocused = self.isFocused
            }
            .onDisappear {
                self.isFocused = false
            }
            .onChange(of: self.isFocused) { _, isFocused in
                if self.isTextFieldFocused != isFocused {
                    self.isTextFieldFocused = isFocused
                }
            }
            .onChange(of: self.isTextFieldFocused) { _, isTextFieldFocused in
                if self.isFocused != isTextFieldFocused {
                    self.isFocused = isTextFieldFocused
                }
            }
    }
}

@MainActor
private func firstResponderTextInput(in view: UIView) -> UITextInput? {
    if view.isFirstResponder { return view as? UITextInput }
    return view.subviews.lazy.compactMap { firstResponderTextInput(in: $0) }.first
}

final class AIChatComposerKeyboardController: UIHostingController<AnyView> {
    var canSend: (() -> Bool)?
    var onSend: (() -> Void)?

    private var focusedTextInput: UITextInput? {
        self.viewIfLoaded.flatMap { firstResponderTextInput(in: $0) }
    }

    override var keyCommands: [UIKeyCommand]? {
        let inheritedCommands = super.keyCommands ?? []
        guard self.focusedTextInput != nil else { return inheritedCommands }
        // Exact modifier matching leaves Shift+Return and Option+Return to the text view.
        let returnCommands = [UIKeyModifierFlags(), .numericPad].flatMap { modifierFlags in
            ["\r", "\u{3}"].map {
                UIKeyCommand(input: $0, modifierFlags: modifierFlags, action: #selector(self.composerReturn(_:)))
            }
        }
        for command in returnCommands {
            command.wantsPriorityOverSystemBehavior = true
        }
        return inheritedCommands + returnCommands
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(self.composerReturn(_:)) {
            // Marked text means an input method is composing; Return must confirm it instead.
            guard let textInput = self.focusedTextInput else { return false }
            return textInput.markedTextRange == nil
        }
        return super.canPerformAction(action, withSender: sender)
    }

    /// Swallows Return when sending is unavailable; it never stops a running reply.
    @objc private func composerReturn(_ command: UIKeyCommand) {
        guard self.canSend?() == true else { return }
        self.onSend?()
    }
}
