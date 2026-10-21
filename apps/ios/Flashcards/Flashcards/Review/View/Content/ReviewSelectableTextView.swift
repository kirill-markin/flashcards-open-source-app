import SwiftUI
import UIKit

struct ReviewSelectableTextView: UIViewRepresentable {
    let sourceText: String
    let content: ReviewRenderedContent
    let surfaceStyle: ReviewCardSurfaceStyle
    @State private var attachmentLayoutVersion = 0

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> ReviewSelectionTextView {
        let view = ReviewSelectionTextView(usingTextLayoutManager: true)
        view.isEditable = false
        view.isSelectable = true
        view.delegate = view
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: ReviewSelectionTextView, context: Context) {
        _ = self.attachmentLayoutVersion
        view.onAttachmentSizeChange = { self.attachmentLayoutVersion += 1 }
        let font = UIFont.preferredFont(forTextStyle: .body)
        let identity = "\(self.sourceText)-\(font.pointSize)-\(context.environment.colorScheme)-\(context.environment.displayScale)"
        guard context.coordinator.identity != identity else { return }
        context.coordinator.identity = identity
        view.resignFirstResponder()
        do {
            view.applyReviewContent(try makeReviewSelectableContent(
                content: self.content,
                surfaceStyle: self.surfaceStyle,
                environment: context.environment
            ))
        } catch {
            view.applyReviewContent(NSAttributedString(
                string: error.localizedDescription,
                attributes: [.font: font, .foregroundColor: UIColor.systemRed]
            ))
        }
        view.selectedRange = NSRange(location: 0, length: 0)
        view.accessibilityIdentifier = self.surfaceStyle == .front
            ? UITestIdentifier.reviewFrontSelectableText : UITestIdentifier.reviewBackSelectableText
        view.rebuildAccessibilityContent()
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ReviewSelectionTextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        return uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    }

    final class Coordinator {
        var identity: String?
    }
}

extension NSAttributedString {
    var reviewSelectionCopyText: String {
        let selected = NSMutableAttributedString(attributedString: self)
        selected.enumerateAttribute(.attachment, in: NSRange(location: 0, length: selected.length), options: .reverse) { value, range, _ in
            if let attachment = value as? ReviewContentAttachment {
                selected.replaceCharacters(in: range, with: attachment.copyText)
            }
        }
        return selected.string
    }
}

final class ReviewSelectionTextView: UITextView, UITextViewDelegate, UIGestureRecognizerDelegate {
    var onAttachmentSizeChange: (() -> Void)?
    var forwardsSelectAllToWholeSide = false
    private weak var wholeSideSelectionOwner: ReviewSelectionTextView?

    func applyReviewContent(_ content: NSAttributedString) {
        content.enumerateAttribute(.attachment, in: NSRange(location: 0, length: content.length)) { value, _, _ in
            (value as? ReviewContentAttachment)?.selectionTextView = self
        }
        self.attributedText = content
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        self.wholeSideSelectionOwner = nil
        if self.forwardsSelectAllToWholeSide {
            var ancestor = self.superview
            while let view = ancestor {
                if let selector = view as? ReviewSelectionTextView {
                    self.wholeSideSelectionOwner = selector.wholeSideSelectionOwner ?? selector
                    break
                }
                ancestor = view.superview
            }
        }
        #if targetEnvironment(macCatalyst)
        if self.pointerSelectionGesture.view == nil {
            self.addGestureRecognizer(self.pointerSelectionGesture)
        }
        #endif
    }

    private func hostedAttachmentHit(at point: CGPoint, event: UIEvent?) -> UIView? {
        var hit: UIView?
        self.attributedText.enumerateAttribute(.attachment, in: NSRange(location: 0, length: self.attributedText.length)) { value, _, stop in
            guard let attachment = value as? ReviewContentAttachment,
                  let host = attachment.accessibilityView(in: self), host.isDescendant(of: self),
                  let hostedHit = host.hitTest(host.convert(point, from: self), with: event) else { return }
            hit = hostedHit
            stop.pointee = true
        }
        return hit
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard self.isUserInteractionEnabled, self.isHidden == false, self.alpha > 0.01,
              self.point(inside: point, with: event) else { return nil }
        return self.hostedAttachmentHit(at: point, event: event) ?? super.hitTest(point, with: event)
    }

    func rebuildAccessibilityContent() {
        var elements: [Any] = []
        var start = 0
        func appendText(until end: Int) {
            guard end > start else { return }
            let textRange = NSRange(location: start, length: end - start)
            self.attributedText.enumerateAttribute(.link, in: textRange) { value, range, _ in
                let element = ReviewSelectionAccessibilityElement(textView: self, range: range)
                element.accessibilityAttributedLabel = self.attributedText.attributedSubstring(from: range)
                if let url = value as? URL ?? (value as? String).flatMap({ URL(string: $0) }) {
                    element.accessibilityTraits = .link
                    element.accessibilityActivateBlock = {
                        UIApplication.shared.open(url, options: [:], completionHandler: nil)
                        return true
                    }
                } else {
                    element.accessibilityTraits = .staticText
                }
                element.accessibilityIdentifier = self.accessibilityIdentifier
                if #available(iOS 18.1, *) { element.accessibilityTextInputResponder = self }
                elements.append(element)
            }
        }
        self.attributedText.enumerateAttribute(.attachment, in: NSRange(location: 0, length: self.attributedText.length)) { value, range, _ in
            guard let attachment = value as? ReviewContentAttachment else { return }
            appendText(until: range.location)
            if let view = attachment.accessibilityView(in: self) {
                elements.append(view)
            } else {
                let element = ReviewSelectionAccessibilityElement(textView: self, range: range)
                element.accessibilityLabel = attachment.copyText
                element.accessibilityTraits = .staticText
                elements.append(element)
            }
            start = NSMaxRange(range)
        }
        self.isAccessibilityElement = start == 0
        if start == 0 {
            self.accessibilityElements = nil
        } else {
            appendText(until: self.attributedText.length)
            self.accessibilityElements = elements
        }
    }

    override var canBecomeFirstResponder: Bool { self.isSelectable }

    #if targetEnvironment(macCatalyst)
    // Catalyst's read-only text interaction needs a primary-pointer range gesture.
    private var pointerSelectionAnchor: UITextPosition?
    private lazy var pointerSelectionGesture: UIPanGestureRecognizer = {
        let gesture = UIPanGestureRecognizer(target: self, action: #selector(self.selectPointerRange(_:)))
        gesture.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.indirectPointer.rawValue)]
        gesture.delegate = self
        return gesture
    }()

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard gestureRecognizer === self.pointerSelectionGesture else { return true }
        var ancestor = touch.view
        while let view = ancestor, view !== self {
            if view is UITextView || view is UIControl { return false }
            ancestor = view.superview
        }
        return self.hostedAttachmentHit(at: touch.location(in: self), event: nil) == nil
    }

    @objc private func selectPointerRange(_ gesture: UIPanGestureRecognizer) {
        guard self.isSelectable else { return }
        let point = gesture.location(in: self)
        if gesture.state == .began {
            guard gesture.buttonMask.contains(.primary) else { return }
            let translation = gesture.translation(in: self)
            self.pointerSelectionAnchor = self.closestPosition(to: CGPoint(x: point.x - translation.x, y: point.y - translation.y))
            self.becomeFirstResponder()
        }
        if let anchor = self.pointerSelectionAnchor, let position = self.closestPosition(to: point) {
            self.selectedTextRange = self.compare(anchor, to: position) == .orderedDescending
                ? self.textRange(from: position, to: anchor)
                : self.textRange(from: anchor, to: position)
        }
        if gesture.state == .ended || gesture.state == .cancelled || gesture.state == .failed {
            self.pointerSelectionAnchor = nil
        }
    }
    #endif

    func textViewDidChangeSelection(_ textView: UITextView) {
        if self.selectedRange.length > 0 && self.isFirstResponder == false {
            self.becomeFirstResponder()
        }
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(selectAll(_:)) {
            if let owner = self.wholeSideSelectionOwner {
                return owner.attributedText.length > 0
            }
            return self.attributedText.length > 0 && self.selectedRange.length < self.attributedText.length
        }
        return super.canPerformAction(action, withSender: sender)
    }

    override func selectAll(_ sender: Any?) {
        if let owner = self.wholeSideSelectionOwner {
            owner.selectAll(sender)
            return
        }
        self.becomeFirstResponder()
        self.selectedRange = NSRange(location: 0, length: self.attributedText.length)
    }

    override func copy(_ sender: Any?) {
        UIPasteboard.general.string = self.attributedText.attributedSubstring(from: self.selectedRange).reviewSelectionCopyText
    }
}

private final class ReviewSelectionAccessibilityElement: UIAccessibilityElement {
    private weak var textView: ReviewSelectionTextView?
    private let range: NSRange

    init(textView: ReviewSelectionTextView, range: NSRange) {
        self.textView = textView
        self.range = range
        super.init(accessibilityContainer: textView)
    }

    override var accessibilityFrameInContainerSpace: CGRect {
        get {
            guard let textView = self.textView,
                  let start = textView.position(from: textView.beginningOfDocument, offset: self.range.location),
                  let end = textView.position(from: start, offset: self.range.length),
                  let textRange = textView.textRange(from: start, to: end) else { return .zero }
            let frame = textView.selectionRects(for: textRange)
                .reduce(CGRect.null) { $0.union($1.rect) }
            return frame.isNull ? .zero : frame
        }
        set { super.accessibilityFrameInContainerSpace = newValue }
    }
}

enum ReviewContentAttachmentLayout {
    case inline
    case block
}

final class ReviewContentAttachment: NSTextAttachment {
    @MainActor private static let contentType: String = {
        let contentType = "com.nibomo.review-content"
        #if targetEnvironment(macCatalyst)
        NSTextAttachment.registerViewProviderClass(MacReviewContentAttachmentProvider.self, forFileType: contentType)
        #else
        NSTextAttachment.registerViewProviderClass(ReviewContentAttachmentProvider.self, forFileType: contentType)
        #endif
        return contentType
    }()

    let content: AnyView
    let copyText: String
    private let layout: ReviewContentAttachmentLayout
    weak var accessibilityView: UIView?
    @MainActor weak var selectionTextView: ReviewSelectionTextView?
    #if targetEnvironment(macCatalyst)
    @MainActor private let hostedViews = NSHashTable<UIView>.weakObjects()
    #else
    @MainActor private var hostingController: UIHostingController<AnyView>?
    @MainActor private var isSizeNotificationScheduled = false
    @MainActor private var lastMeasuredBounds: CGRect?
    @MainActor private var lastMeasurementWidth: CGFloat?
    #endif

    @MainActor
    init(content: AnyView, copyText: String, layout: ReviewContentAttachmentLayout) {
        self.content = content
        self.copyText = copyText
        self.layout = layout
        super.init(data: Data(copyText.utf8), ofType: Self.contentType)
    }

    required init?(coder: NSCoder) { nil }

    @MainActor
    fileprivate func accessibilityView(in textView: ReviewSelectionTextView) -> UIView? {
        #if targetEnvironment(macCatalyst)
        return self.hostedViews.allObjects.first { $0.isDescendant(of: textView) }
        #else
        return self.accessibilityView
        #endif
    }

    #if targetEnvironment(macCatalyst)
    @MainActor
    func copyForTableCell() -> ReviewContentAttachment {
        ReviewContentAttachment(content: self.content, copyText: self.copyText, layout: self.layout)
    }

    @MainActor
    fileprivate func registerHostedView(_ view: UIView) { self.hostedViews.add(view) }
    #endif

    nonisolated override func viewProvider(for parentView: UIView?, location: any NSTextLocation, textContainer: NSTextContainer?) -> NSTextAttachmentViewProvider? {
        let provider = super.viewProvider(for: parentView, location: location, textContainer: textContainer)
        provider?.tracksTextAttachmentViewBounds = true
        return provider
    }

    #if !targetEnvironment(macCatalyst)
    @MainActor
    private func hostedController() -> UIHostingController<AnyView> {
        if let controller = self.hostingController { return controller }
        let controller = self.makeHostedController { [weak self] in self?.scheduleSizeNotification() }
        self.hostingController = controller
        controller.view.backgroundColor = .clear
        controller.view.isAccessibilityElement = false
        return controller
    }

    @MainActor
    fileprivate func hostedView() -> UIView { self.hostedController().view }
    #endif

    @MainActor
    fileprivate func makeHostedController(onSizeChange: @escaping () -> Void) -> UIHostingController<AnyView> {
        let content: AnyView
        switch self.layout {
        case .inline:
            content = self.content
        case .block:
            content = AnyView(self.content.frame(maxWidth: .infinity, alignment: .leading))
        }
        let controller = UIHostingController(rootView: AnyView(content
            .fixedSize(horizontal: false, vertical: true)
            .onGeometryChange(for: CGSize.self) { proxy in
                proxy.size
            } action: { _ in
                onSizeChange()
            }))
        return controller
    }

    #if !targetEnvironment(macCatalyst)
    @MainActor
    private func measuredBounds(width: CGFloat) -> CGRect {
        self.measuredBounds(width: width, controller: self.hostedController())
    }
    #endif

    @MainActor
    fileprivate func measuredBounds(width: CGFloat, controller: UIHostingController<AnyView>) -> CGRect {
        let size = controller.sizeThatFits(in: CGSize(width: width, height: .greatestFiniteMagnitude))
        let scale = max(self.selectionTextView?.traitCollection.displayScale ?? 1, 1)
        let measuredWidth: CGFloat
        switch self.layout {
        case .inline:
            measuredWidth = min(size.width, width)
        case .block:
            measuredWidth = width
        }
        return CGRect(origin: .zero, size: CGSize(
            width: (measuredWidth * scale).rounded(.up) / scale,
            height: (max(size.height, 1) * scale).rounded(.up) / scale
        ))
    }

    #if !targetEnvironment(macCatalyst)
    @MainActor
    fileprivate func layoutBounds(proposedWidth: CGFloat) -> CGRect {
        let width = max(proposedWidth, 1)
        let bounds = self.measuredBounds(width: width)
        self.lastMeasurementWidth = width
        self.lastMeasuredBounds = bounds
        return bounds
    }

    @MainActor
    private func scheduleSizeNotification() {
        guard self.isSizeNotificationScheduled == false else { return }
        self.isSizeNotificationScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            defer { self.isSizeNotificationScheduled = false }
            guard let textView = self.selectionTextView else { return }
            // Measurement proposals can precede display; asynchronous changes use the actual owner width.
            let width = textView.bounds.width - textView.textContainerInset.left - textView.textContainerInset.right
                - 2 * textView.textContainer.lineFragmentPadding
            guard width > 0 else { return }
            let bounds = self.measuredBounds(width: width)
            guard self.lastMeasurementWidth != width || self.lastMeasuredBounds != bounds else { return }
            self.lastMeasurementWidth = width
            self.lastMeasuredBounds = bounds
            if let manager = textView.textLayoutManager, let range = manager.textContentManager?.documentRange {
                manager.invalidateLayout(for: range)
            }
            textView.invalidateIntrinsicContentSize()
            textView.setNeedsLayout()
            textView.onAttachmentSizeChange?()
        }
    }
    #endif
}

#if targetEnvironment(macCatalyst)
private final class MacReviewContentAttachmentProvider: NSTextAttachmentViewProvider {
    @MainActor private var hostingController: UIHostingController<AnyView>?
    @MainActor private var lastMeasurementWidth: CGFloat?
    @MainActor private var notifiedBoundsByWidth: [CGFloat: CGRect] = [:]
    @MainActor private var isSizeNotificationScheduled = false

    @MainActor
    private func hostedController(for attachment: ReviewContentAttachment) -> UIHostingController<AnyView> {
        if let controller = self.hostingController { return controller }
        let controller = attachment.makeHostedController { [weak self] in self?.scheduleSizeNotification() }
        self.hostingController = controller
        controller.view.backgroundColor = .clear
        controller.view.isAccessibilityElement = false
        return controller
    }

    nonisolated override func loadView() {
        nonisolated(unsafe) let provider: MacReviewContentAttachmentProvider = self
        MainActor.assumeIsolated {
            guard let attachment = provider.textAttachment as? ReviewContentAttachment else { return }
            provider.view = provider.hostedController(for: attachment).view
            if let view = provider.view { attachment.registerHostedView(view) }
            attachment.selectionTextView?.rebuildAccessibilityContent()
        }
    }

    nonisolated override func attachmentBounds(for attributes: [NSAttributedString.Key: Any], location: any NSTextLocation, textContainer: NSTextContainer?, proposedLineFragment: CGRect, position: CGPoint) -> CGRect {
        nonisolated(unsafe) let provider: MacReviewContentAttachmentProvider = self
        return MainActor.assumeIsolated {
            guard let attachment = provider.textAttachment as? ReviewContentAttachment else { return .zero }
            let width = max(proposedLineFragment.width, 1)
            let bounds = attachment.measuredBounds(width: width, controller: provider.hostedController(for: attachment))
            // Minimum-width probes must not become the baseline for the displayed fragment's size.
            if provider.notifiedBoundsByWidth[width] == nil { provider.notifiedBoundsByWidth[width] = bounds }
            provider.lastMeasurementWidth = width
            return bounds
        }
    }

    @MainActor
    private func scheduleSizeNotification() {
        guard self.isSizeNotificationScheduled == false else { return }
        self.isSizeNotificationScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            defer { self.isSizeNotificationScheduled = false }
            guard let attachment = self.textAttachment as? ReviewContentAttachment,
                  let textView = attachment.selectionTextView,
                  let width = self.lastMeasurementWidth else { return }
            textView.rebuildAccessibilityContent()
            let bounds = attachment.measuredBounds(width: width, controller: self.hostedController(for: attachment))
            guard self.notifiedBoundsByWidth[width] != bounds else { return }
            self.notifiedBoundsByWidth[width] = bounds
            if let manager = self.textLayoutManager, let range = manager.textContentManager?.documentRange {
                manager.invalidateLayout(for: range)
            }
            textView.invalidateIntrinsicContentSize()
            textView.setNeedsLayout()
            textView.onAttachmentSizeChange?()
        }
    }
}
#else
private final class ReviewContentAttachmentProvider: NSTextAttachmentViewProvider {
    nonisolated override func loadView() {
        // TextKit's Objective-C callbacks lack the UI host's main-actor annotations.
        nonisolated(unsafe) let provider: ReviewContentAttachmentProvider = self
        MainActor.assumeIsolated {
            guard let attachment = provider.textAttachment as? ReviewContentAttachment else { return }
            provider.view = attachment.hostedView()
            attachment.accessibilityView = provider.view
            attachment.selectionTextView?.rebuildAccessibilityContent()
        }
    }

    nonisolated override func attachmentBounds(for attributes: [NSAttributedString.Key: Any], location: any NSTextLocation, textContainer: NSTextContainer?, proposedLineFragment: CGRect, position: CGPoint) -> CGRect {
        nonisolated(unsafe) let provider: ReviewContentAttachmentProvider = self
        return MainActor.assumeIsolated {
            guard let attachment = provider.textAttachment as? ReviewContentAttachment else { return .zero }
            return attachment.layoutBounds(proposedWidth: proposedLineFragment.width)
        }
    }
}
#endif
