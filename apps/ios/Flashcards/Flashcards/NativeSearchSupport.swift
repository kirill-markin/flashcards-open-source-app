import SwiftUI
import UIKit

struct NativeSearchRow: View {
    static let scrollID: UUID = UUID()

    @Binding var text: String
    @FocusState.Binding var isFocused: Bool
    let prompt: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            TextField(self.prompt, text: self.$text)
                .textFieldStyle(.plain)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused(self.$isFocused)
                .onSubmit { self.isFocused = false }
                .accessibilityLabel(self.prompt)
                .accessibilityAddTraits(.isSearchField)
            if self.text.isEmpty == false {
                Button {
                    self.text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                        .frame(minWidth: appMinimumTouchTarget, minHeight: appMinimumTouchTarget)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(String(localized: "text_input.clear", table: "Foundation"))
            }
        }
        .frame(minHeight: appMinimumTouchTarget)
        .padding(.leading, 12)
        .padding(.trailing, self.text.isEmpty ? 12 : 0)
        .padding(.vertical, 2)
        .nativeTextInputFocusTarget(isFocused: self.$isFocused)
        .nativeTextInputBackground(cornerRadius: 24)
        .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .id(Self.scrollID)
    }
}

extension View {
    func nativeSearchKeyboardShortcut(
        isFocused: Bool,
        onFocus: @escaping () -> Void,
        prompt: String,
        isEnabled: Bool = true,
        scrollProxy: ScrollViewProxy
    ) -> some View {
        self.modifier(NativeSearchKeyboardShortcut(
            isFocused: isFocused,
            onFocus: onFocus,
            prompt: prompt,
            isEnabled: isEnabled,
            scrollProxy: scrollProxy
        ))
    }
}

private struct NativeSearchKeyboardShortcut: ViewModifier {
    let isFocused: Bool
    let onFocus: () -> Void
    let prompt: String
    let isEnabled: Bool
    let scrollProxy: ScrollViewProxy
    @State private var isVisible: Bool = false

    @ViewBuilder
    func body(content: Content) -> some View {
        #if targetEnvironment(macCatalyst)
        content
        #else
        content
            .background {
                if self.isEnabled && self.isVisible {
                    NativeSearchKeyCommand(
                        prompt: self.prompt,
                        isFocused: self.isFocused,
                        onFocus: {
                            self.scrollProxy.scrollTo(NativeSearchRow.scrollID, anchor: .top)
                            DispatchQueue.main.async {
                                self.onFocus()
                            }
                        }
                    )
                    .frame(width: 0, height: 0)
                    .accessibilityHidden(true)
                }
            }
            .onAppear { self.isVisible = true }
            .onDisappear { self.isVisible = false }
        #endif
    }
}

private struct NativeSearchKeyCommand: UIViewRepresentable {
    let prompt: String
    let isFocused: Bool
    let onFocus: @MainActor () -> Void

    func makeUIView(context: Context) -> NativeSearchKeyCommandView {
        let view = NativeSearchKeyCommandView(frame: .zero)
        view.configure(prompt: self.prompt, isFocused: self.isFocused, onFocus: self.onFocus)
        return view
    }

    func updateUIView(_ view: NativeSearchKeyCommandView, context: Context) {
        view.configure(prompt: self.prompt, isFocused: self.isFocused, onFocus: self.onFocus)
    }

    static func dismantleUIView(_ view: NativeSearchKeyCommandView, coordinator: ()) {
        view.unregister()
        view.onFocus = nil
    }
}

@MainActor
private enum NativeSearchCommandRegistry {
    struct Entry {
        weak var view: NativeSearchKeyCommandView?
    }

    static var targets: [String: Entry] = [:]
    static var owners: [ObjectIdentifier: Entry] = [:]

    static func perform(_ command: UIKeyCommand) {
        guard let identifier = command.propertyList as? String else { return }
        self.targets[identifier]?.view?.onFocus?()
    }
}

private extension UIViewController {
    @objc func nibomoFocusNativeSearch(_ command: UIKeyCommand) {
        NativeSearchCommandRegistry.perform(command)
    }
}

/// The section uses a UIKit hosting controller. Register there for both idle and text-editing focus.
private final class NativeSearchKeyCommandView: UIView {
    let identifier: String = UUID().uuidString
    var onFocus: (@MainActor () -> Void)?
    private var prompt: String = ""
    private var wasFocused: Bool = false
    private var hasRegistered: Bool = false
    private var isObserving: Bool = false
    private var command: UIKeyCommand?
    private weak var controller: UIViewController?
    private var controllerIdentifier: ObjectIdentifier?

    override var canBecomeFirstResponder: Bool { true }
    override var keyCommands: [UIKeyCommand]? { self.command.map { [$0] } }

    func configure(prompt: String, isFocused: Bool, onFocus: @escaping @MainActor () -> Void) {
        self.onFocus = onFocus
        let promptChanged = self.prompt != prompt
        self.prompt = prompt
        if promptChanged && self.command != nil {
            self.unregister()
            self.hasRegistered = false
        }
        if self.hasRegistered == false || (isFocused && self.wasFocused == false) {
            self.registerIfReady()
        }
        self.wasFocused = isFocused
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard self.window != nil else { self.unregister(); return }
        if self.isObserving == false {
            self.isObserving = true
            for name in [UITextField.textDidEndEditingNotification, UITextView.textDidEndEditingNotification] {
                NotificationCenter.default.addObserver(self, selector: #selector(self.editingDidEnd(_:)), name: name, object: nil)
            }
            NotificationCenter.default.addObserver(self, selector: #selector(self.windowDidBecomeKey(_:)), name: UIWindow.didBecomeKeyNotification, object: nil)
        }
        self.registerIfReady()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private func registerIfReady() {
        guard self.window != nil, self.controller == nil else { return }
        var responder = self.next
        while let current = responder, current is UIViewController == false { responder = current.next }
        guard let controller = responder as? UIViewController else { return }
        let controllerIdentifier = ObjectIdentifier(controller)
        NativeSearchCommandRegistry.owners[controllerIdentifier]?.view?.unregister()
        let command = UIKeyCommand(
            title: self.prompt,
            action: #selector(UIViewController.nibomoFocusNativeSearch(_:)),
            input: "f",
            modifierFlags: .command,
            propertyList: self.identifier
        )
        self.controller = controller
        self.controllerIdentifier = controllerIdentifier
        self.command = command
        self.hasRegistered = true
        NativeSearchCommandRegistry.targets[self.identifier] = .init(view: self)
        NativeSearchCommandRegistry.owners[controllerIdentifier] = .init(view: self)
        controller.addKeyCommand(command)
        self.claimKeyboardIfUnowned()
    }

    func unregister() {
        if let controllerIdentifier = self.controllerIdentifier,
           NativeSearchCommandRegistry.owners[controllerIdentifier]?.view === self {
            if let command = self.command { self.controller?.removeKeyCommand(command) }
            NativeSearchCommandRegistry.owners.removeValue(forKey: controllerIdentifier)
        }
        NativeSearchCommandRegistry.targets.removeValue(forKey: self.identifier)
        self.controller = nil
        self.controllerIdentifier = nil
        self.command = nil
        if self.isFirstResponder { _ = self.resignFirstResponder() }
    }

    private func claimKeyboardIfUnowned() {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.command != nil, let window = self.window, window.isKeyWindow else { return }
            if let responder = self.firstResponder(in: window), responder !== window { return }
            _ = self.becomeFirstResponder()
        }
    }

    @objc(nibomoFocusNativeSearch:) private func focusSearch(_ command: UIKeyCommand) {
        NativeSearchCommandRegistry.perform(command)
    }

    @objc private func editingDidEnd(_ notification: Notification) {
        guard let view = notification.object as? UIView, view.window === self.window else { return }
        self.claimKeyboardIfUnowned()
    }

    @objc private func windowDidBecomeKey(_ notification: Notification) {
        guard let window = notification.object as? UIWindow, window === self.window else { return }
        self.claimKeyboardIfUnowned()
    }

    private func firstResponder(in view: UIView) -> UIView? {
        if view.isFirstResponder { return view }
        for subview in view.subviews {
            if let responder = self.firstResponder(in: subview) { return responder }
        }
        return nil
    }
}
