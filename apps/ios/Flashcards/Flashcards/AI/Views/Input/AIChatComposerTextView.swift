import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The AI chat draft field. A UIKit text view, unlike a SwiftUI `TextField`, lets the composer own paste.
struct AIChatComposerTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var selection: TextSelection?
    @Binding var isFocused: Bool
    /// True while a drag the shared attachment rule accepts hovers over the field, which takes it from the chat-root drop.
    @Binding var isAttachmentDropHovering: Bool
    let placeholder: String
    let isDisabled: Bool
    let canAttachToDraft: Bool
    let maximumLineCount: Int
    /// Receives pasted or dropped items that carry a file or image; plain text stays with the text view.
    let onAttachmentItemProviders: @MainActor ([NSItemProvider]) -> Void
    #if targetEnvironment(macCatalyst)
    let macReturnKeyOwner: MacComposerReturnKeyOwner
    #endif

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> AIChatComposerUITextView {
        let textView = AIChatComposerUITextView(usingTextLayoutManager: true)
        textView.configureComposer()
        textView.delegate = context.coordinator
        textView.textDropDelegate = context.coordinator
        textView.accessibilityIdentifier = UITestIdentifier.aiComposerTextField
        textView.onDidMoveToWindow = { [weak coordinator = context.coordinator, weak textView] in
            guard let coordinator, let textView else { return }
            coordinator.scheduleFocusSync(textView: textView)
        }
        return textView
    }

    func updateUIView(_ textView: AIChatComposerUITextView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        coordinator.isUpdatingView = true
        defer { coordinator.isUpdatingView = false }

        textView.placeholderLabel.text = self.placeholder
        textView.accessibilityLabel = self.placeholder
        textView.isComposerDisabled = self.isDisabled
        textView.canAttachToDraft = self.canAttachToDraft
        textView.onAttachmentItemProviders = self.onAttachmentItemProviders
        #if targetEnvironment(macCatalyst)
        textView.macReturnKeyOwner = self.macReturnKeyOwner
        #endif
        // Replacing text or selection while an input method composes would cancel the composition.
        if textView.markedTextRange == nil {
            let didReplaceText = textView.text != self.text
            if didReplaceText {
                textView.text = self.text
            }
            // The binding can drop a write (inactive presentation), so only a selection SwiftUI changed is applied.
            let selectionRange = aiChatComposerNSRange(text: self.text, selection: self.selection)
            if didReplaceText || selectionRange != coordinator.lastBindingSelectionRange,
               let selectionRange, textView.selectedRange != selectionRange {
                textView.selectedRange = selectionRange
            }
            coordinator.lastBindingSelectionRange = selectionRange
        }
        textView.refreshPlaceholderVisibility()
        coordinator.scheduleFocusSync(textView: textView)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: AIChatComposerUITextView, context: Context) -> CGSize? {
        uiView.composerFittingSize(proposedWidth: proposal.width, maximumLineCount: self.maximumLineCount)
    }

    static func dismantleUIView(_ textView: AIChatComposerUITextView, coordinator: Coordinator) {
        coordinator.isUpdatingView = true
        if textView.isFirstResponder {
            textView.resignFirstResponder()
        }
        textView.delegate = nil
        textView.textDropDelegate = nil
        coordinator.isUpdatingView = false
        // A field removed mid-drag gets no exit or end callback; the write must wait for the SwiftUI update to end.
        DispatchQueue.main.async {
            coordinator.setAttachmentDropHovering(false)
        }
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate, UITextDropDelegate {
        var parent: AIChatComposerTextView
        var isUpdatingView: Bool
        var lastBindingSelectionRange: NSRange?

        init(parent: AIChatComposerTextView) {
            self.parent = parent
            self.isUpdatingView = false
            self.lastBindingSelectionRange = nil
        }

        /// Runs on the next main-queue turn, outside the SwiftUI update, and reads the binding again.
        func scheduleFocusSync(textView: AIChatComposerUITextView) {
            guard self.isFocusSettled(textView: textView) == false else { return }
            DispatchQueue.main.async { [weak self, weak textView] in
                guard let self, let textView else { return }
                self.syncFocus(textView: textView)
            }
        }

        /// A request on a disabled field reads back as unfocused; a request before the field is in a window
        /// waits for `didMoveToWindow`.
        private func syncFocus(textView: AIChatComposerUITextView) {
            guard self.isFocusSettled(textView: textView) == false else { return }
            if self.parent.isDisabled {
                if textView.isFirstResponder {
                    textView.resignFirstResponder()
                }
                if self.parent.isFocused {
                    self.parent.isFocused = false
                }
            } else if self.parent.isFocused == false {
                textView.resignFirstResponder()
            } else if textView.window != nil, textView.becomeFirstResponder() == false {
                self.parent.isFocused = false
            }
        }

        private func isFocusSettled(textView: AIChatComposerUITextView) -> Bool {
            if self.parent.isDisabled {
                return self.parent.isFocused == false && textView.isFirstResponder == false
            }
            return self.parent.isFocused == textView.isFirstResponder
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            self.setFocusBinding(true)
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            self.setFocusBinding(false)
        }

        func textViewDidChange(_ textView: UITextView) {
            guard self.isUpdatingView == false else { return }
            if self.parent.text != textView.text {
                self.parent.text = textView.text
            }
            (textView as? AIChatComposerUITextView)?.refreshPlaceholderVisibility()
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            guard self.isUpdatingView == false,
                  let range = Range(textView.selectedRange, in: textView.text) else { return }
            if case .selection(let currentRange) = self.parent.selection?.indices, currentRange == range {
                return
            }
            self.parent.selection = TextSelection(range: range)
        }

        /// The text view would insert a dragged file as its name or contents, so this delegate performs such drops
        /// and forbids them while attaching is blocked.
        func textDroppableView(
            _ textDroppableView: UIView & UITextDroppable,
            proposalForDrop drop: any UITextDropRequest
        ) -> UITextDropProposal {
            let carriesAttachment = aiChatDropCarriesAttachment(drop: drop)
            self.setAttachmentDropHovering(carriesAttachment)
            guard carriesAttachment else {
                return drop.suggestedProposal
            }
            guard self.canPerformAttachmentDrop() else {
                return UITextDropProposal(operation: .forbidden)
            }
            let proposal = UITextDropProposal(operation: .copy)
            proposal.dropPerformer = .delegate
            return proposal
        }

        func textDroppableView(_ textDroppableView: UIView & UITextDroppable, willPerformDrop drop: any UITextDropRequest) {
            self.setAttachmentDropHovering(false)
            guard self.canPerformAttachmentDrop(), aiChatDropCarriesAttachment(drop: drop) else { return }
            self.parent.onAttachmentItemProviders(drop.dropSession.items.map(\.itemProvider))
        }

        func textDroppableView(_ textDroppableView: UIView & UITextDroppable, dropSessionDidExit session: any UIDropSession) {
            self.setAttachmentDropHovering(false)
        }

        func textDroppableView(_ textDroppableView: UIView & UITextDroppable, dropSessionDidEnd session: any UIDropSession) {
            self.setAttachmentDropHovering(false)
        }

        private func canPerformAttachmentDrop() -> Bool {
            self.parent.isDisabled == false && self.parent.canAttachToDraft
        }

        func setAttachmentDropHovering(_ isHovering: Bool) {
            guard self.parent.isAttachmentDropHovering != isHovering else { return }
            self.parent.isAttachmentDropHovering = isHovering
        }

        /// Disabling the field inside a SwiftUI update resigns it synchronously; that write must wait for the update to end.
        private func setFocusBinding(_ isFocused: Bool) {
            guard self.isUpdatingView else {
                if self.parent.isFocused != isFocused {
                    self.parent.isFocused = isFocused
                }
                return
            }
            DispatchQueue.main.async { [weak self] in
                guard let self, self.parent.isFocused != isFocused else { return }
                self.parent.isFocused = isFocused
            }
        }
    }
}

@MainActor
private func aiChatDropCarriesAttachment(drop: any UITextDropRequest) -> Bool {
    drop.dropSession.items.contains { item in
        aiChatItemProviderCanMakeAttachment(itemProvider: item.itemProvider)
    }
}

/// Reads pasteboard types only; reading its contents outside an explicit paste would show the paste prompt.
private func aiChatPasteboardHoldsAttachment(pasteboard: UIPasteboard) -> Bool {
    (pasteboard.types(forItemSet: nil) ?? []).contains { typeIdentifiers in
        aiChatContentTypesMakeAttachment(contentTypes: typeIdentifiers.compactMap { UTType($0) })
    }
}

/// Selection indices may belong to a previous text value; those are not applied.
private func aiChatComposerNSRange(text: String, selection: TextSelection?) -> NSRange? {
    guard case .selection(let range) = selection?.indices,
          range.lowerBound >= text.startIndex,
          range.upperBound <= text.endIndex,
          range.lowerBound.samePosition(in: text.utf16) != nil,
          range.upperBound.samePosition(in: text.utf16) != nil else { return nil }
    return NSRange(range, in: text)
}

final class AIChatComposerUITextView: UITextView {
    let placeholderLabel = UILabel()
    var canAttachToDraft = false
    var isComposerDisabled = false {
        didSet {
            guard oldValue != self.isComposerDisabled else { return }
            self.isEditable = self.isComposerDisabled == false
            self.isSelectable = self.isComposerDisabled == false
            self.textColor = self.isComposerDisabled ? .secondaryLabel : .label
        }
    }
    #if targetEnvironment(macCatalyst)
    weak var macReturnKeyOwner: MacComposerReturnKeyOwner?
    #endif
    var onDidMoveToWindow: (() -> Void)?
    var onAttachmentItemProviders: (@MainActor ([NSItemProvider]) -> Void)?

    func configureComposer() {
        let font = UIFont.preferredFont(forTextStyle: .body)
        self.font = font
        self.adjustsFontForContentSizeCategory = true
        self.textColor = .label
        self.backgroundColor = .clear
        self.textContainerInset = .zero
        self.textContainer.lineFragmentPadding = 0
        self.autocorrectionType = .no
        self.isScrollEnabled = false
        self.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        self.placeholderLabel.font = font
        self.placeholderLabel.adjustsFontForContentSizeCategory = true
        self.placeholderLabel.textColor = .placeholderText
        self.placeholderLabel.numberOfLines = 0
        self.placeholderLabel.isAccessibilityElement = false
        self.addSubview(self.placeholderLabel)
    }

    func refreshPlaceholderVisibility() {
        self.placeholderLabel.isHidden = self.text.isEmpty == false
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if self.window != nil {
            self.onDidMoveToWindow?()
        }
    }

    // Paste shows for a copied image or file even without text on the pasteboard, while attaching is allowed.
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(UIResponderStandardEditActions.paste(_:)),
           self.isEditable,
           self.canAttachToDraft,
           self.onAttachmentItemProviders != nil,
           aiChatPasteboardHoldsAttachment(pasteboard: .general) {
            return true
        }
        return super.canPerformAction(action, withSender: sender)
    }

    /// A Finder copy also carries the file name as text, so a pasteboard with a file or image pastes none of its text;
    /// while attaching is blocked, the pasteboard pastes as text.
    override func paste(_ sender: Any?) {
        let itemProviders = UIPasteboard.general.itemProviders
        guard self.canAttachToDraft,
              let onAttachmentItemProviders = self.onAttachmentItemProviders,
              itemProviders.contains(where: { aiChatContentTypesMakeAttachment(contentTypes: $0.registeredContentTypes) }) else {
            super.paste(sender)
            return
        }
        onAttachmentItemProviders(itemProviders)
    }

    override var canBecomeFirstResponder: Bool {
        self.isEditable && super.canBecomeFirstResponder
    }

    override var accessibilityTraits: UIAccessibilityTraits {
        get { self.isComposerDisabled ? super.accessibilityTraits.union(.notEnabled) : super.accessibilityTraits }
        set { super.accessibilityTraits = newValue }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let width = self.placeholderWidth(textViewWidth: self.bounds.width)
        let height = self.placeholderLabel.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        self.placeholderLabel.frame = CGRect(
            x: self.textContainerInset.left + self.textContainer.lineFragmentPadding,
            y: self.textContainerInset.top,
            width: width,
            height: height
        )
    }

    /// Grows with its lines up to `maximumLineCount`, then scrolls; an empty draft fits its wrapped placeholder.
    func composerFittingSize(proposedWidth: CGFloat?, maximumLineCount: Int) -> CGSize {
        guard let font = self.font else {
            preconditionFailure("The AI composer text view has no font to measure its lines.")
        }
        let measuringWidth = proposedWidth.flatMap { $0.isFinite ? $0 : nil } ?? .greatestFiniteMagnitude
        let textSize = self.sizeThatFits(CGSize(width: measuringWidth, height: .greatestFiniteMagnitude))
        let verticalInset = self.textContainerInset.top + self.textContainerInset.bottom
        var contentHeight = textSize.height
        if self.text.isEmpty {
            let placeholderSize = self.placeholderLabel.sizeThatFits(CGSize(
                width: self.placeholderWidth(textViewWidth: measuringWidth),
                height: .greatestFiniteMagnitude
            ))
            contentHeight = max(contentHeight, ceil(placeholderSize.height) + verticalInset)
        }
        let maximumHeight = ceil(font.lineHeight * CGFloat(maximumLineCount) + verticalInset)
        self.updateScrolling(isEnabled: contentHeight > maximumHeight)
        return CGSize(
            width: measuringWidth == .greatestFiniteMagnitude ? textSize.width : measuringWidth,
            height: min(contentHeight, maximumHeight)
        )
    }

    private func placeholderWidth(textViewWidth: CGFloat) -> CGFloat {
        max(0, textViewWidth - self.textContainerInset.left - self.textContainerInset.right - 2 * self.textContainer.lineFragmentPadding)
    }

    private func updateScrolling(isEnabled: Bool) {
        guard self.isScrollEnabled != isEnabled else { return }
        self.isScrollEnabled = isEnabled
        guard isEnabled else {
            self.contentOffset = .zero
            return
        }
        // The new height lands after this layout pass; keep the caret line in view once it does.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.scrollRangeToVisible(self.selectedRange)
        }
    }

    // SwiftUI key presses never reach a UIKit first responder, so modified Return is read from UIKit presses.
    #if targetEnvironment(macCatalyst)
    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        if presses.count == 1, let key = presses.first?.key, self.macReturnKeyOwner?.handlePressBegan(key) == true {
            return
        }
        super.pressesBegan(presses, with: event)
    }

    override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        if presses.count == 1, let key = presses.first?.key, self.macReturnKeyOwner?.handlePressEnded(key) == true {
            return
        }
        super.pressesEnded(presses, with: event)
    }

    override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        if presses.count == 1, let key = presses.first?.key, self.macReturnKeyOwner?.handlePressEnded(key) == true {
            return
        }
        super.pressesCancelled(presses, with: event)
    }
    #endif
}
