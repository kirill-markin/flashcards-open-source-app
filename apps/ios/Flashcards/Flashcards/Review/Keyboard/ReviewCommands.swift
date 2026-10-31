import SwiftUI
import UIKit

private let reviewCardsStringsTableName: String = "ReviewCards"

/// A nil action disables its command, so the key reaches normal handling.
struct ReviewKeyboardActions {
    let revealAnswer: (@MainActor () -> Void)?
    let rate: (@MainActor (ReviewRating) -> Void)?
}

/// The Review menu shows the keys and serves pointer clicks. The window's `ReviewKeyCommandController`
/// binds the same keys with priority over focus and text editing; either way, one key press runs one action.
struct ReviewCommands: Commands {
    @FocusedValue(\.reviewKeyCommandTarget) private var target: ReviewKeyCommandTarget?

    var body: some Commands {
        CommandMenu(String(localized: "Review", table: reviewCardsStringsTableName)) {
            ReviewMenuItems(target: self.target)
        }
    }
}

private struct ReviewMenuItems: View {
    let target: ReviewKeyCommandTarget?

    var body: some View {
        Button(String(localized: "Show answer", table: reviewCardsStringsTableName)) {
            self.target?.actions?.revealAnswer?()
        }
        .keyboardShortcut(.space, modifiers: [])
        .disabled(self.target?.actions?.revealAnswer == nil)
        Divider()
        ForEach(ReviewRating.allCases) { rating in
            Button(localizedReviewRatingTitle(rating: rating)) {
                self.target?.actions?.rate?(rating)
            }
            .keyboardShortcut(KeyEquivalent(Character(reviewRatingKey(rating))), modifiers: [])
            .disabled(self.target?.actions?.rate == nil)
        }
    }
}

extension View {
    /// Disables the Review commands while this view's sheet, alert, or picker is up, so Space,
    /// Return, and digits reach the presentation instead of the card behind it.
    func reviewKeyboardBlockingPresentation(isPresented: Bool) -> some View {
        self.modifier(ReviewKeyboardBlockingPresentationModifier(isPresented: isPresented))
    }
}

private struct ReviewKeyboardBlockingPresentationModifier: ViewModifier {
    let isPresented: Bool
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @State private var id: UUID = UUID()

    func body(content: Content) -> some View {
        content
            .onAppear {
                self.navigation.setReviewKeyboardBlockingPresentation(id: self.id, isPresented: self.isPresented)
            }
            .onChange(of: self.isPresented) { _, isPresented in
                self.navigation.setReviewKeyboardBlockingPresentation(id: self.id, isPresented: isPresented)
            }
            .onDisappear {
                self.navigation.setReviewKeyboardBlockingPresentation(id: self.id, isPresented: false)
            }
    }
}

/// Reports whether a text input in this view's window is editing, so typed characters
/// such as "1" in the AI companion composer never reach the Review commands.
struct ReviewTextEditingObserver: UIViewRepresentable {
    @Binding var isEditing: Bool

    func makeUIView(context: Context) -> ReviewTextEditingView {
        let view = ReviewTextEditingView()
        view.isUserInteractionEnabled = false
        view.onEditingChange = { isEditing in
            self.isEditing = isEditing
        }
        return view
    }

    func updateUIView(_ uiView: ReviewTextEditingView, context: Context) {}

    final class ReviewTextEditingView: UIView {
        var onEditingChange: ((Bool) -> Void)?
        private let editingInputs: NSHashTable<UIView> = NSHashTable.weakObjects()

        override init(frame: CGRect) {
            super.init(frame: frame)
            let center = NotificationCenter.default
            for name in [UITextField.textDidBeginEditingNotification, UITextView.textDidBeginEditingNotification] {
                center.addObserver(self, selector: #selector(self.inputDidBeginEditing(_:)), name: name, object: nil)
            }
            for name in [UITextField.textDidEndEditingNotification, UITextView.textDidEndEditingNotification] {
                center.addObserver(self, selector: #selector(self.inputDidEndEditing(_:)), name: name, object: nil)
            }
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            // Editing that began before Review entered this window posted its notification already.
            self.editingInputs.removeAllObjects()
            if let window = self.window, let input = editingTextInput(in: window) {
                self.editingInputs.add(input)
            }
            self.reportEditingState()
        }

        @objc private func inputDidBeginEditing(_ notification: Notification) {
            guard let input = notification.object as? UIView, let window = self.window, input.window === window else { return }
            self.editingInputs.add(input)
            self.reportEditingState()
        }

        @objc private func inputDidEndEditing(_ notification: Notification) {
            guard let input = notification.object as? UIView, self.editingInputs.contains(input) else { return }
            self.editingInputs.remove(input)
            self.reportEditingState()
        }

        private func reportEditingState() {
            // UIKit can post these while SwiftUI is updating, for example when @FocusState focuses a field.
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                // An input can stop editing or leave this window without posting an end notification.
                for input in self.editingInputs.allObjects where input.window !== self.window || isEditingTextInput(input) == false {
                    self.editingInputs.remove(input)
                }
                self.onEditingChange?(self.editingInputs.allObjects.isEmpty == false)
            }
        }
    }
}

@MainActor
private func isEditingTextInput(_ view: UIView) -> Bool {
    if let field = view as? UITextField { return field.isEditing }
    if let textView = view as? UITextView { return textView.isEditable && textView.isFirstResponder }
    return false
}

@MainActor
private func editingTextInput(in view: UIView) -> UIView? {
    if isEditingTextInput(view) { return view }
    return view.subviews.lazy.compactMap { editingTextInput(in: $0) }.first
}
