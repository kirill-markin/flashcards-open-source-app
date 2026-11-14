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
    #if !targetEnvironment(macCatalyst)
    /// Space above the first line inside the text view, so scrolled lines run up to the composer's edge.
    let topContentInset: CGFloat
    #endif
    /// Receives pasted or dropped items that carry a file or image; plain text stays with the text view.
    let onAttachmentItemProviders: @MainActor ([NSItemProvider]) -> Void
    /// Read as the field enters a window: another section's chat in that window held the keyboard, so this one takes it
    /// straight away.
    let takesKeyboardOnArrival: @MainActor (UIWindowScene?) -> Bool
    /// The window scene the field shows in, which scopes its keyboard to that window.
    let onWindowSceneChange: @MainActor (UIWindowScene?) -> Void
    #if targetEnvironment(macCatalyst)
    let macReturnKeyOwner: MacComposerReturnKeyOwner
    #endif

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> AIChatComposerUITextView {
        // The designated initializer runs this subclass's property initializers, which the TextKit 2 factory
        // initializer skips on iOS 27; it already lays out with TextKit 2.
        let textView = AIChatComposerUITextView(frame: .zero, textContainer: nil)
        textView.configureComposer()
        textView.isComposerDisabled = self.isDisabled
        textView.delegate = context.coordinator
        textView.textDropDelegate = context.coordinator
        textView.accessibilityIdentifier = UITestIdentifier.aiComposerTextField
        textView.onDidMoveToWindow = { [weak coordinator = context.coordinator, weak textView] in
            guard let coordinator, let textView else { return }
            coordinator.parent.onWindowSceneChange(textView.window?.windowScene)
            coordinator.takeKeyboardOnArrival(textView: textView)
            coordinator.scheduleFocusSync(textView: textView)
        }
        #if !targetEnvironment(macCatalyst)
        textView.onKeyboardLost = { [weak coordinator = context.coordinator, weak textView] in
            // Reported from inside the other field's take-over, which can run during a SwiftUI update.
            DispatchQueue.main.async {
                guard let coordinator, let textView, textView.isFirstResponder == false else { return }
                coordinator.setFocusBinding(false)
            }
        }
        #endif
        return textView
    }

    func updateUIView(_ textView: AIChatComposerUITextView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        coordinator.isUpdatingView = true
        defer { coordinator.isUpdatingView = false }

        textView.placeholderLabel.text = self.placeholder
        textView.accessibilityLabel = self.placeholder
        textView.canAttachToDraft = self.canAttachToDraft
        textView.onAttachmentItemProviders = self.onAttachmentItemProviders
        #if targetEnvironment(macCatalyst)
        textView.macReturnKeyOwner = self.macReturnKeyOwner
        #else
        if textView.textContainerInset.top != self.topContentInset {
            textView.textContainerInset.top = self.topContentInset
        }
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
            AIChatComposerUITextView.resignDeliberately {
                _ = textView.resignFirstResponder()
            }
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

        /// Becomes first responder while the previous chat's field still holds the keyboard, in the same update as the
        /// section switch, so the keyboard moves between the fields without going down. The focus binding follows on
        /// the next turn.
        func takeKeyboardOnArrival(textView: AIChatComposerUITextView) {
            #if !targetEnvironment(macCatalyst)
            guard textView.isFirstResponder == false,
                  self.parent.isDisabled == false,
                  self.parent.takesKeyboardOnArrival(textView.window?.windowScene) else { return }
            self.isUpdatingView = true
            defer { self.isUpdatingView = false }
            _ = textView.becomeFirstResponder()
            #endif
        }

        /// Runs on the next main-queue turn, outside the SwiftUI update, and reads the binding again.
        func scheduleFocusSync(textView: AIChatComposerUITextView) {
            guard textView.isComposerDisabled != self.parent.isDisabled
                    || self.isFocusSettled(textView: textView) == false else { return }
            DispatchQueue.main.async { [weak self, weak textView] in
                guard let self, let textView, textView.delegate === self else { return }
                // Disabling a focused text view can synchronously resign first responder and re-enter SwiftUI.
                textView.isComposerDisabled = self.parent.isDisabled
                self.syncFocus(textView: textView)
            }
        }

        /// A request on a disabled field reads back as unfocused; a request before the field is in a window
        /// waits for `didMoveToWindow`.
        private func syncFocus(textView: AIChatComposerUITextView) {
            guard self.isFocusSettled(textView: textView) == false else { return }
            if self.parent.isDisabled {
                if textView.isFirstResponder {
                    AIChatComposerUITextView.resignDeliberately {
                        _ = textView.resignFirstResponder()
                    }
                }
                if self.parent.isFocused {
                    self.parent.isFocused = false
                }
            } else if self.parent.isFocused == false {
                AIChatComposerUITextView.resignDeliberately {
                    _ = textView.resignFirstResponder()
                }
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

        fileprivate func setFocusBinding(_ isFocused: Bool) {
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

private let aiChatComposerTextStyle: UIFont.TextStyle = .body

@MainActor
func aiChatComposerFont(dynamicTypeSize: DynamicTypeSize) -> UIFont {
    UIFont.preferredFont(
        forTextStyle: aiChatComposerTextStyle,
        compatibleWith: UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(dynamicTypeSize))
    )
}

/// The draft's width laid out on a single line in the composer font.
@MainActor
func aiChatComposerSingleLineWidth(text: String, dynamicTypeSize: DynamicTypeSize) -> CGFloat {
    ceil((text as NSString).size(withAttributes: [.font: aiChatComposerFont(dynamicTypeSize: dynamicTypeSize)]).width)
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
        let font = UIFont.preferredFont(forTextStyle: aiChatComposerTextStyle)
        self.font = font
        self.adjustsFontForContentSizeCategory = true
        self.textColor = .label
        self.backgroundColor = .clear
        self.textContainerInset = .zero
        self.textContainer.lineFragmentPadding = 0
        self.autocorrectionType = .no
        #if !targetEnvironment(macCatalyst)
        // Keeps the keyboard short: no suggestion bar, and no iPad undo/redo/paste bar that would keep it showing.
        self.spellCheckingType = .no
        self.inlinePredictionType = .no
        self.inputAssistantItem.leadingBarButtonGroups = []
        self.inputAssistantItem.trailingBarButtonGroups = []
        #endif
        self.isScrollEnabled = false
        self.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        self.placeholderLabel.font = font
        self.placeholderLabel.adjustsFontForContentSizeCategory = true
        self.placeholderLabel.textColor = .placeholderText
        #if targetEnvironment(macCatalyst)
        self.placeholderLabel.numberOfLines = 0
        #else
        // The empty single-row composer is one line tall, so its placeholder truncates instead of wrapping.
        self.placeholderLabel.numberOfLines = 1
        self.placeholderLabel.lineBreakMode = .byTruncatingTail
        #endif
        self.placeholderLabel.isAccessibilityElement = false
        self.addSubview(self.placeholderLabel)
    }

    func refreshPlaceholderVisibility() {
        self.placeholderLabel.isHidden = self.text.isEmpty == false
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if self.window != nil {
            #if !targetEnvironment(macCatalyst)
            self.lastWindow = self.window
            #endif
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

    /// True while the app itself resigns a field, which the section-switch hold never refuses.
    private static var isResigningDeliberately: Bool = false

    /// Runs a resign the app chose, such as a tap on the transcript, a send, or a field leaving its view.
    static func resignDeliberately(_ resign: () -> Void) {
        let wasResigningDeliberately = Self.isResigningDeliberately
        Self.isResigningDeliberately = true
        defer { Self.isResigningDeliberately = wasResigningDeliberately }
        resign()
    }

    // The Mac keeps its own focus behavior: no section-switch hold and no hand-over between sections.
    #if !targetEnvironment(macCatalyst)
    /// The field taking the keyboard from another chat's field; that hand-over is always allowed.
    private static var fieldTakingKeyboard: AIChatComposerUITextView?
    /// The field that last took the keyboard. One that left its window before losing the keyboard gets no end of
    /// editing, so whatever took the keyboard reports the loss through `onKeyboardLost`.
    private static weak var keyboardHolder: AIChatComposerUITextView?
    var onKeyboardLost: (() -> Void)?
    private weak var lastWindow: UIWindow?

    /// Ends the keyboard of the chat field in `scene` when no chat on screen takes it over. A field that left its
    /// window keeps the first responder and cannot resign it, so a responder in that window takes it and lets it go.
    static func releaseKeyboard(in scene: UIWindowScene?) {
        guard let holder = Self.keyboardHolder, holder.isFirstResponder,
              let window = holder.lastWindow, window.windowScene === scene else { return }
        Self.resignDeliberately {
            if holder.window != nil {
                _ = holder.resignFirstResponder()
                return
            }
            let releaser = AIChatKeyboardReleaser()
            window.addSubview(releaser)
            if releaser.becomeFirstResponder() {
                _ = releaser.resignFirstResponder()
            }
            releaser.removeFromSuperview()
        }
        holder.onKeyboardLost?()
    }

    /// Ends the keyboard of a chat field that left its window still holding it, which a resign through the responder
    /// chain cannot reach.
    static func releaseOrphanedKeyboard() {
        guard let holder = Self.keyboardHolder, holder.isFirstResponder, holder.window == nil else { return }
        Self.releaseKeyboard(in: holder.lastWindow?.windowScene)
    }

    override func becomeFirstResponder() -> Bool {
        let previousField = Self.fieldTakingKeyboard
        Self.fieldTakingKeyboard = self
        defer { Self.fieldTakingKeyboard = previousField }
        let didBecome = super.becomeFirstResponder()
        if didBecome {
            if let holder = Self.keyboardHolder, holder !== self, holder.isFirstResponder == false {
                holder.onKeyboardLost?()
            }
            Self.keyboardHolder = self
        }
        if didBecome, let window = self.window {
            AIChatSectionSwitchTouchTracker.install(in: window)
        }
        return didBecome
    }

    /// Selecting a section in the tab bar or sidebar moves UIKit's focus, and with it the first responder, to that bar
    /// before the section switches. The chat keeps its keyboard across sections, so during that touch alone the field
    /// stays first responder until the next chat's field takes it; the tracker resigns it if none does. Another text
    /// input, a presentation, and the app's own dismissals always take the first responder.
    override var canResignFirstResponder: Bool {
        if Self.isResigningDeliberately {
            return super.canResignFirstResponder
        }
        if let takingField = Self.fieldTakingKeyboard, takingField !== self {
            AIChatSectionSwitchTouchTracker.tracker(holding: self)?.release(self)
            return super.canResignFirstResponder
        }
        let tracker = self.window.flatMap(AIChatSectionSwitchTouchTracker.tracker(in:))
            ?? AIChatSectionSwitchTouchTracker.tracker(holding: self)
        if let tracker,
           tracker.holdsKeyboardForSectionSwitch,
           self.window?.rootViewController?.presentedViewController == nil {
            tracker.hold(self)
            return false
        }
        return super.canResignFirstResponder
    }
    #endif

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

    /// Grows with its lines up to `maximumLineCount`, fewer on a short iOS window, then scrolls; an empty draft fits its placeholder.
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
        var lineCount = maximumLineCount
        #if !targetEnvironment(macCatalyst)
        // Accessibility text on a short window, such as Duo's outer display, would otherwise cover the whole chat.
        if let windowHeight = self.window?.bounds.height {
            let fittingLineCount = Int(windowHeight * aiChatComposerMaximumWindowHeightFraction / font.lineHeight)
            lineCount = min(lineCount, max(1, fittingLineCount))
        }
        #endif
        let maximumHeight = ceil(font.lineHeight * CGFloat(lineCount) + verticalInset)
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

#if !targetEnvironment(macCatalyst)
/// Takes the first responder from a chat field that left its window, then gives it up.
private final class AIChatKeyboardReleaser: UIView {
    override var canBecomeFirstResponder: Bool { true }
}

/// Notes whether the window's touches are selecting a section in the tab controller's own bar or sidebar, so a chat
/// field can keep the keyboard while that touch switches sections. Any other touch in the same sequence, such as a
/// second finger on a search field, ends the hold. It never recognizes, delays or cancels touches.
@MainActor
final class AIChatSectionSwitchTouchTracker: UIGestureRecognizer {
    /// From a touch on a section item until the turn after the last touch of its sequence ends, which is when the
    /// selection has switched the section.
    private(set) var holdsKeyboardForSectionSwitch: Bool = false
    private var liveTouches: Set<ObjectIdentifier> = []
    private var touchesSectionItem: Bool = false
    private var touchesElsewhere: Bool = false
    private var sequence: Int = 0
    /// The field that kept the keyboard; it resigns afterwards unless another chat's field took over.
    private weak var heldField: AIChatComposerUITextView?

    static func install(in window: UIWindow) {
        guard self.tracker(in: window) == nil else { return }
        window.addGestureRecognizer(AIChatSectionSwitchTouchTracker(target: nil, action: nil))
    }

    static func tracker(in window: UIWindow) -> AIChatSectionSwitchTouchTracker? {
        window.gestureRecognizers?.lazy.compactMap { $0 as? AIChatSectionSwitchTouchTracker }.first
    }

    /// The tracker of whichever window the field kept the keyboard in; a held field may already have left its window.
    static func tracker(holding field: AIChatComposerUITextView) -> AIChatSectionSwitchTouchTracker? {
        for scene in UIApplication.shared.connectedScenes {
            for window in (scene as? UIWindowScene)?.windows ?? [] {
                if let tracker = self.tracker(in: window), tracker.heldField === field {
                    return tracker
                }
            }
        }
        return nil
    }

    override init(target: Any?, action: Selector?) {
        super.init(target: target, action: action)
        self.cancelsTouchesInView = false
        self.delaysTouchesBegan = false
        self.delaysTouchesEnded = false
    }

    func hold(_ field: AIChatComposerUITextView) {
        self.heldField = field
    }

    func release(_ field: AIChatComposerUITextView) {
        if self.heldField === field {
            self.heldField = nil
        }
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        if self.liveTouches.isEmpty {
            self.sequence += 1
            self.touchesSectionItem = false
            self.touchesElsewhere = false
        }
        for touch in touches {
            self.liveTouches.insert(ObjectIdentifier(touch))
            if let view = touch.view, Self.isSectionItem(view) {
                self.touchesSectionItem = true
            } else {
                self.touchesElsewhere = true
            }
        }
        self.holdsKeyboardForSectionSwitch = self.touchesSectionItem && self.touchesElsewhere == false
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        self.endTouches(touches)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        self.endTouches(touches)
    }

    override func reset() {
        super.reset()
        self.liveTouches.removeAll()
    }

    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool {
        false
    }

    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool {
        false
    }

    /// The bar selects on touch-up and the section switches right after, so the hold ends on the next turn, unless a
    /// newer touch sequence has begun by then.
    private func endTouches(_ touches: Set<UITouch>) {
        for touch in touches {
            self.liveTouches.remove(ObjectIdentifier(touch))
        }
        guard self.liveTouches.isEmpty else { return }
        self.state = .failed
        let endedSequence = self.sequence
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let field = self.heldField, field.window == nil, field.isFirstResponder {
                AIChatComposerUITextView.releaseOrphanedKeyboard()
            }
            self.heldField = nil
            if self.sequence == endedSequence, self.liveTouches.isEmpty {
                self.holdsKeyboardForSectionSwitch = false
            }
        }
    }

    /// A tab item in the tab controller's bar or sidebar, outside the selected section's own view.
    private static func isSectionItem(_ view: UIView) -> Bool {
        var isItem = false
        var responder: UIResponder? = view
        while let current = responder {
            if current is UICollectionViewCell || current is UIControl {
                isItem = true
            }
            if let tabController = current as? UITabBarController {
                // Tabs built from `UITab` leave `viewControllers` empty, so the selected section is the reference.
                guard isItem, let sectionView = tabController.selectedViewController?.viewIfLoaded else { return false }
                return view.isDescendant(of: sectionView) == false
            }
            responder = current.next
        }
        return false
    }
}
#endif
