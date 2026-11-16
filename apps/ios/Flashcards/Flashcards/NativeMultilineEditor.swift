import SwiftUI
import UIKit

/// A plain native editor whose keyboard traits are ready before its first focus.
struct NativeMultilineEditor: View {
    @Environment(\.nativeEditorEditingChanged) private var editingChanged
    @Environment(\.nativeEditorHeightChanged) private var heightChanged
    @Environment(\.nativeEditorScrollTarget) private var containingRow
    @State private var editorID = UUID()
    private var scrollID: UUID { self.containingRow ?? self.editorID }
    @Binding var text: String
    var selection: Binding<TextSelection?>? = nil
    var isFocused: FocusState<Bool>.Binding? = nil
    var hidesScrollBackground: Bool = false
    var autocapitalization: UITextAutocapitalizationType = .sentences
    var lineLimits: ClosedRange<Int>? = nil
    let accessibilityLabel: String
    var accessibilityIdentifier: String = ""

    @ViewBuilder
    var body: some View {
        #if targetEnvironment(macCatalyst)
        Group {
            if self.hidesScrollBackground {
                self.macEditor.scrollContentBackground(.hidden)
            } else {
                self.macEditor
            }
        }
        .accessibilityLabel(self.accessibilityLabel)
        .accessibilityIdentifier(self.accessibilityIdentifier)
        #else
        ZStack(alignment: .topLeading) {
            // An unattached FocusState loses programmatic requests; UIKit still owns responder changes below.
            self.focusedEditor(NativeMultilineEditorView(
                text: self.$text,
                selection: self.selection,
                focus: self.isFocused.map { focus in
                    Binding(get: { focus.wrappedValue }, set: { focus.wrappedValue = $0 })
                },
                autocapitalization: self.autocapitalization,
                lineLimits: self.lineLimits,
                accessibilityLabel: self.accessibilityLabel,
                accessibilityIdentifier: self.accessibilityIdentifier,
                editingChanged: { focused in self.editingChanged?(self.editorID, self.scrollID, focused) }
            ))
            if self.lineLimits != nil && self.text.isEmpty {
                Text(self.accessibilityLabel)
                    .foregroundStyle(Color(uiColor: .placeholderText))
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
        .id(self.editorID)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
            self.heightChanged?(self.editorID, height)
        }
        #endif
    }

    #if targetEnvironment(macCatalyst)
    @ViewBuilder
    private var macEditor: some View {
        if let limits = self.lineLimits {
            self.focusedEditor(TextField(self.accessibilityLabel, text: self.$text, axis: .vertical).lineLimit(limits))
        } else if let selection = self.selection {
            self.focusedEditor(TextEditor(text: self.$text, selection: selection))
        } else {
            self.focusedEditor(TextEditor(text: self.$text))
        }
    }

    #endif

    @ViewBuilder
    private func focusedEditor<Editor: View>(_ editor: Editor) -> some View {
        if let focus = self.isFocused { editor.focused(focus) } else { editor }
    }
}

private struct NativeEditorEditingChangedKey: EnvironmentKey {
    static let defaultValue: (@MainActor (UUID, UUID, Bool) -> Void)? = nil
}

private struct NativeEditorScrollTargetKey: EnvironmentKey {
    static let defaultValue: UUID? = nil
}

private struct NativeEditorHeightChangedKey: EnvironmentKey {
    static let defaultValue: (@MainActor (UUID, CGFloat) -> Void)? = nil
}

private extension EnvironmentValues {
    var nativeEditorScrollTarget: UUID? {
        get { self[NativeEditorScrollTargetKey.self] }
        set { self[NativeEditorScrollTargetKey.self] = newValue }
    }

    var nativeEditorHeightChanged: (@MainActor (UUID, CGFloat) -> Void)? {
        get { self[NativeEditorHeightChangedKey.self] }
        set { self[NativeEditorHeightChangedKey.self] = newValue }
    }

    var nativeEditorEditingChanged: (@MainActor (UUID, UUID, Bool) -> Void)? {
        get { self[NativeEditorEditingChangedKey.self] }
        set { self[NativeEditorEditingChangedKey.self] = newValue }
    }
}

extension View {
    @ViewBuilder
    func nativeEditorScrollTarget(_ identifier: UUID) -> some View {
        #if targetEnvironment(macCatalyst)
        self
        #else
        self.id(identifier).environment(\.nativeEditorScrollTarget, identifier)
        #endif
    }

    @ViewBuilder
    func nativeEditorKeyboardAvoidance() -> some View {
        #if targetEnvironment(macCatalyst)
        self
        #else
        self.modifier(NativeEditorKeyboardAvoidance())
        #endif
    }
}

#if !targetEnvironment(macCatalyst)
private struct NativeEditorKeyboardAvoidance: ViewModifier {
    @State private var focusedEditor: UUID?
    @State private var scrollTarget: UUID?
    @State private var editorHeights: [UUID: CGFloat] = [:]

    func body(content: Content) -> some View {
        ScrollViewReader { proxy in
            content
                .scrollDismissesKeyboard(.interactively)
                .environment(\.nativeEditorHeightChanged) { identifier, height in
                    self.editorHeights[identifier] = height
                }
                .environment(\.nativeEditorEditingChanged) { identifier, target, focused in
                    if focused {
                        self.focusedEditor = identifier
                        self.scrollTarget = target
                    } else if self.focusedEditor == identifier {
                        self.focusedEditor = nil
                        self.scrollTarget = nil
                    }
                }
                .onChange(of: self.focusedEditor) { self.revealEditor(using: proxy) }
                .onChange(of: self.focusedHeight) { self.revealEditor(using: proxy) }
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
                    self.revealEditor(using: proxy)
                }
        }
    }

    private var focusedHeight: CGFloat {
        self.focusedEditor.flatMap { self.editorHeights[$0] } ?? 0
    }

    private func revealEditor(using proxy: ScrollViewProxy) {
        guard let identifier = self.focusedEditor, let target = self.scrollTarget else { return }
        Task { @MainActor in
            await Task.yield()
            guard self.focusedEditor == identifier else { return }
            // List scrolls the containing row; its bottom includes every growing editor in that row.
            withAnimation { proxy.scrollTo(target, anchor: .bottom) }
        }
    }
}

private struct NativeMultilineEditorView: UIViewRepresentable {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.layoutDirection) private var layoutDirection
    @Binding var text: String
    let selection: Binding<TextSelection?>?
    let focus: Binding<Bool>?
    let autocapitalization: UITextAutocapitalizationType
    let lineLimits: ClosedRange<Int>?
    let accessibilityLabel: String
    let accessibilityIdentifier: String
    let editingChanged: @MainActor (Bool) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> NativeMultilineTextView {
        let view = NativeMultilineTextView(frame: .zero, textContainer: nil)
        NativeCompactKeyboard.configureTextView(view)
        view.autocapitalizationType = self.autocapitalization
        view.adjustsFontForContentSizeCategory = true
        view.textContainerInset = self.lineLimits == nil ? UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0) : .zero
        view.textContainer.lineFragmentPadding = self.lineLimits == nil ? 5 : 0
        view.isScrollEnabled = true
        view.keyboardDismissMode = .interactive
        view.alwaysBounceVertical = self.lineLimits == nil
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        view.text = self.text
        view.delegate = context.coordinator
        view.onWindowChange = { [weak coordinator = context.coordinator, weak view] in
            if let view { coordinator?.scheduleFocus(view) }
        }
        return view
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: NativeMultilineTextView, context: Context) -> CGSize? {
        guard let limits = self.lineLimits, let width = proposal.width, width.isFinite, width > 0 else { return nil }
        let lineHeight = uiView.font?.lineHeight ?? UIFont.preferredFont(forTextStyle: .body).lineHeight
        let contentHeight = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        return CGSize(width: width, height: min(max(contentHeight, lineHeight * CGFloat(limits.lowerBound)), lineHeight * CGFloat(limits.upperBound)))
    }

    func updateUIView(_ view: NativeMultilineTextView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        coordinator.isUpdating = true
        defer { coordinator.isUpdating = false }
        let interfaceStyle: UIUserInterfaceStyle = self.colorScheme == .dark ? .dark : .light
        if view.overrideUserInterfaceStyle != interfaceStyle { view.overrideUserInterfaceStyle = interfaceStyle }
        let font = UIFont.preferredFont(forTextStyle: .body, compatibleWith:
            UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(self.dynamicTypeSize)))
        if view.font != font { view.font = font }
        let textColor: UIColor = self.isEnabled ? .label : .secondaryLabel
        let semantics: UISemanticContentAttribute = self.layoutDirection == .rightToLeft ? .forceRightToLeft : .forceLeftToRight
        if view.textColor != textColor { view.textColor = textColor }
        // SwiftUI's Form/List or the caller's material supplies the editor surface.
        if view.backgroundColor != .clear { view.backgroundColor = .clear }
        if view.semanticContentAttribute != semantics { view.semanticContentAttribute = semantics }
        if view.accessibilityLabel != self.accessibilityLabel { view.accessibilityLabel = self.accessibilityLabel }
        let identifier = self.accessibilityIdentifier.isEmpty ? nil : self.accessibilityIdentifier
        if view.accessibilityIdentifier != identifier { view.accessibilityIdentifier = identifier }
        if view.isEditable != self.isEnabled { view.isEditable = self.isEnabled }
        if view.isSelectable != self.isEnabled { view.isSelectable = self.isEnabled }
        if view.isUserInteractionEnabled != self.isEnabled { view.isUserInteractionEnabled = self.isEnabled }

        // External replacements during marked-text composition are unsupported; callers must defer them until composition commits.
        if view.markedTextRange == nil {
            let replaced = view.text != self.text
            if replaced {
                let previousSelection = view.selectedRange
                if let range = view.textRange(from: view.beginningOfDocument, to: view.endOfDocument) {
                    view.replace(range, withText: self.text)
                }
                let count = self.text.utf16.count
                let location = min(previousSelection.location, count)
                view.selectedRange = NSRange(location: location, length: min(previousSelection.length, count - location))
            }
            let selectionRange = self.selection.flatMap { Self.nsRange(text: self.text, selection: $0.wrappedValue) }
            if replaced || selectionRange != coordinator.lastBindingSelection {
                if let selectionRange, view.selectedRange != selectionRange { view.selectedRange = selectionRange }
            }
            coordinator.lastBindingSelection = selectionRange
        }
        coordinator.scheduleFocus(view)
    }

    static func dismantleUIView(_ view: NativeMultilineTextView, coordinator: Coordinator) {
        if view.isFirstResponder {
            let editingChanged = coordinator.parent.editingChanged
            // Teardown must clear the scroll focus after SwiftUI finishes updating.
            DispatchQueue.main.async { editingChanged(false) }
        }
        view.delegate = nil
        view.onWindowChange = nil
        if view.isFirstResponder { view.resignFirstResponder() }
    }

    private static func nsRange(text: String, selection: TextSelection?) -> NSRange? {
        guard case .selection(let range) = selection?.indices,
              range.lowerBound >= text.startIndex, range.upperBound <= text.endIndex,
              range.lowerBound.samePosition(in: text.utf16) != nil,
              range.upperBound.samePosition(in: text.utf16) != nil else { return nil }
        return NSRange(range, in: text)
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: NativeMultilineEditorView
        var isUpdating = false
        var lastBindingSelection: NSRange?
        private var isFocusScheduled = false

        init(parent: NativeMultilineEditorView) { self.parent = parent }

        func scheduleFocus(_ view: NativeMultilineTextView) {
            guard self.isFocusScheduled == false else { return }
            let requested = self.parent.focus?.wrappedValue
            guard (self.parent.isEnabled == false && view.isFirstResponder)
                || (requested != nil && requested != view.isFirstResponder) else { return }
            self.isFocusScheduled = true
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self else { return }
                self.isFocusScheduled = false
                guard let view, view.delegate === self else { return }
                if self.parent.isEnabled == false || self.parent.focus?.wrappedValue == false {
                    if view.isFirstResponder { view.resignFirstResponder() }
                    self.setFocus(false)
                } else if self.parent.focus?.wrappedValue == true, view.window != nil, view.isFirstResponder == false {
                    view.becomeFirstResponder()
                }
            }
        }

        private func setFocus(_ focused: Bool) {
            if let binding = self.parent.focus, binding.wrappedValue != focused { binding.wrappedValue = focused }
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            if self.isUpdating == false { self.setFocus(true) }
            self.publishEditingChanged(true)
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            if self.isUpdating == false { self.setFocus(false) }
            self.publishEditingChanged(false)
        }

        private func publishEditingChanged(_ focused: Bool) {
            let editingChanged = self.parent.editingChanged
            if self.isUpdating {
                // Disabling a focused view can end editing during a SwiftUI update.
                DispatchQueue.main.async { editingChanged(focused) }
            } else {
                editingChanged(focused)
            }
        }

        func textViewDidChange(_ textView: UITextView) {
            guard self.isUpdating == false else { return }
            if self.parent.text != textView.text { self.parent.text = textView.text }
            self.publishSelection(textView)
        }

        func textViewDidChangeSelection(_ textView: UITextView) { self.publishSelection(textView) }

        private func publishSelection(_ view: UITextView) {
            guard self.isUpdating == false, view.markedTextRange == nil,
                  let selection = self.parent.selection,
                  let range = Range(view.selectedRange, in: view.text),
                  view.selectedRange != self.lastBindingSelection else { return }
            self.lastBindingSelection = view.selectedRange
            selection.wrappedValue = TextSelection(range: range)
        }
    }
}

private final class NativeMultilineTextView: UITextView, NativeCompactKeyboardPreparedInput {
    var onWindowChange: (() -> Void)?
    override func didMoveToWindow() {
        super.didMoveToWindow()
        self.onWindowChange?()
    }
}
#endif
