import SwiftUI
import UIKit

struct ReviewSelectableTextView: UIViewRepresentable {
    let sourceText: String
    let content: ReviewRenderedContent
    let surfaceStyle: ReviewCardSurfaceStyle
    var textFont: UIFont? = nil
    var textColor: UIColor = .label
    var isSelectable: Bool = true
    var lineLimit: Int? = nil
    var activeReviewCardId: String?
    @State private var attachmentLayoutVersion = 0

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> ReviewSelectionTextView {
        let view = ReviewSelectionTextView(usingTextLayoutManager: true)
        view.isEditable = false
        view.isSelectable = self.isSelectable
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
        let font = self.textFont ?? UIFont.preferredFont(forTextStyle: .body)
        let color = self.textColor.resolvedColor(with: UITraitCollection(userInterfaceStyle: context.environment.colorScheme == .dark ? .dark : .light))
        let identity = "\(self.activeReviewCardId ?? "")-\(self.renderingSide.rawValue)-\(self.sourceText)-\(font.fontName)-\(font.pointSize)-\(font.fontDescriptor.symbolicTraits.rawValue)-\(color.cgColor.components ?? [])-\(self.isSelectable)-\(String(describing: self.lineLimit))-\(context.environment.colorScheme)-\(context.environment.displayScale)"
        guard context.coordinator.identity != identity else { return }
        context.coordinator.identity = identity
        context.coordinator.pendingMeasurement = nil

        let render = self.activeReviewCardId.map { cardId in
            ReviewRenderingObservation.Render(cardId: cardId, side: self.renderingSide, id: UUID())
        }
        let preparation = render.map { ReviewRenderingPhaseMeasurement(render: $0, phase: .contentPreparation) }
        let attributedText: NSAttributedString
        do {
            let prepared = try makeReviewSelectableContent(
                content: self.content,
                surfaceStyle: self.surfaceStyle,
                environment: context.environment,
                textFont: self.textFont,
                textColor: self.textColor
            )
            attributedText = prepared.attributedText
            preparation?.complete(
                outcome: prepared.didFailRenderingFormula ? .failure : .success,
                attributedUTF16Count: attributedText.length
            )
        } catch {
            preparation?.complete(outcome: .failure, attributedUTF16Count: nil)
            attributedText = NSAttributedString(
                string: error.localizedDescription,
                attributes: [.font: font, .foregroundColor: UIColor.systemRed]
            )
        }

        let installation = render.map { ReviewRenderingPhaseMeasurement(render: $0, phase: .textInstallation) }
        view.isSelectable = self.isSelectable
        view.textContainer.maximumNumberOfLines = self.lineLimit ?? 0
        view.textContainer.lineBreakMode = self.lineLimit == nil ? .byWordWrapping : .byTruncatingTail
        view.resignFirstResponder()
        view.applyReviewContent(attributedText)
        view.selectedRange = NSRange(location: 0, length: 0)
        if self.textFont == nil {
            view.accessibilityIdentifier = self.surfaceStyle == .front
                ? UITestIdentifier.reviewFrontSelectableText : UITestIdentifier.reviewBackSelectableText
        }
        view.rebuildAccessibilityContent()
        installation?.complete(outcome: .success, attributedUTF16Count: nil)
        context.coordinator.pendingMeasurement = render
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ReviewSelectionTextView, context: Context) -> CGSize? {
        // Horizontal suggestion/chip stacks propose no width; keep those previews bounded.
        guard let width = proposal.width ?? (self.textFont == nil ? nil : 320), width > 0 else { return nil }
        let constraint = CGSize(width: width, height: .greatestFiniteMagnitude)
        guard width.isFinite,
              let render = context.coordinator.pendingMeasurement,
              render.cardId == self.activeReviewCardId, render.side == self.renderingSide else {
            return uiView.sizeThatFits(constraint)
        }

        context.coordinator.pendingMeasurement = nil
        let measurement = ReviewRenderingPhaseMeasurement(render: render, phase: .textMeasurement)
        let size = uiView.sizeThatFits(constraint)
        measurement.complete(
            outcome: size.width.isFinite && size.height.isFinite ? .success : .failure,
            attributedUTF16Count: nil
        )
        return size
    }

    private var renderingSide: ReviewRenderingObservation.Side {
        self.surfaceStyle == .front ? .front : .back
    }

    final class Coordinator {
        var identity: String?
        var pendingMeasurement: ReviewRenderingObservation.Render?
    }
}

private struct ReviewRenderingPhaseMeasurement {
    let render: ReviewRenderingObservation.Render
    let phase: ReviewRenderingObservation.Phase
    let startedAt: Date

    init(render: ReviewRenderingObservation.Render, phase: ReviewRenderingObservation.Phase) {
        FlashcardsObservability.addBreadcrumb(.reviewRendering(ReviewRenderingObservation(
            render: render,
            phase: phase,
            outcome: .start,
            durationMilliseconds: nil,
            attributedUTF16Count: nil
        )))
        self.render = render
        self.phase = phase
        self.startedAt = Date()
    }

    func complete(outcome: ReviewRenderingObservation.Outcome, attributedUTF16Count: Int?) {
        FlashcardsObservability.addBreadcrumb(.reviewRendering(ReviewRenderingObservation(
            render: self.render,
            phase: self.phase,
            outcome: outcome,
            durationMilliseconds: iosObservationDurationMilliseconds(startedAt: self.startedAt, finishedAt: Date()),
            attributedUTF16Count: attributedUTF16Count
        )))
    }
}

extension NSAttributedString {
    var reviewSelectionCopyText: String {
        let selected = NSMutableAttributedString(attributedString: self)
        self.enumerateAttribute(.attachment, in: NSRange(location: 0, length: self.length), options: .reverse) { value, range, _ in
            if let formula = value as? ReviewInlineMathAttachment {
                selected.replaceCharacters(in: range, with: formula.copyText)
                return
            }
            guard let attachment = value as? ReviewContentAttachment else { return }
            var replacedRange = range
            if attachment.copyText.isEmpty {
                // A block attachment owns its line, so with no text its line separator goes too.
                let text = selected.string as NSString
                if NSMaxRange(range) < text.length && text.character(at: NSMaxRange(range)) == 0x0A {
                    replacedRange.length += 1
                } else if range.location > 0 && text.character(at: range.location - 1) == 0x0A {
                    replacedRange = NSRange(location: range.location - 1, length: range.length + 1)
                }
            }
            selected.replaceCharacters(in: replacedRange, with: attachment.copyText)
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
            if let formula = value as? ReviewInlineMathAttachment {
                appendText(until: range.location)
                let element = ReviewSelectionAccessibilityElement(textView: self, range: range)
                element.accessibilityLabel = formula.accessibilityLabelText
                element.accessibilityTraits = .staticText
                element.accessibilityIdentifier = self.accessibilityIdentifier
                if #available(iOS 18.1, *) { element.accessibilityTextInputResponder = self }
                elements.append(element)
                start = NSMaxRange(range)
                return
            }
            guard let attachment = value as? ReviewContentAttachment else { return }
            appendText(until: range.location)
            if let view = attachment.accessibilityView(in: self) {
                elements.append(view)
            } else {
                let element = ReviewSelectionAccessibilityElement(textView: self, range: range)
                switch attachment.accessibility {
                case .text(let label):
                    element.accessibilityLabel = label
                    element.accessibilityTraits = .staticText
                case .image(let label):
                    element.accessibilityLabel = label
                    element.accessibilityTraits = .image
                }
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

final class ReviewInlineMathAttachment: NSTextAttachment {
    let copyText: String
    let accessibilityLabelText: String

    init(image: UIImage, formula: ReviewFormulaContent) {
        self.copyText = formula.originalSource
        self.accessibilityLabelText = formula.latex
        super.init(data: nil, ofType: nil)
        self.image = image
        self.bounds = CGRect(origin: .zero, size: image.size)
        self.allowsTextAttachmentView = false
    }

    required init?(coder: NSCoder) { nil }

    nonisolated override func attachmentBounds(for attributes: [NSAttributedString.Key: Any], location: any NSTextLocation, textContainer: NSTextContainer?, proposedLineFragment: CGRect, position: CGPoint) -> CGRect {
        let width = max(proposedLineFragment.width, 1)
        let bounds = self.bounds
        guard bounds.width > width else { return bounds }
        // Fit an oversized formula to a full line; TextKit wraps it if it cannot fit at the current position.
        return CGRect(origin: bounds.origin, size: CGSize(width: width, height: bounds.height * width / bounds.width))
    }
}

/// What VoiceOver reads for an attachment whose hosted view is not in the text view.
enum ReviewContentAttachmentAccessibility {
    case text(String)
    /// An image without a description has no label, so VoiceOver announces it as an image.
    case image(label: String?)
}

final class ReviewContentAttachment: NSTextAttachment {
    @MainActor private static let contentType: String = {
        let contentType = "com.nibomo.review-content"
        NSTextAttachment.registerViewProviderClass(ReviewContentAttachmentProvider.self, forFileType: contentType)
        return contentType
    }()

    enum Content {
        case hosted(AnyView)
        #if targetEnvironment(macCatalyst)
        case table([[NSAttributedString]])
        #endif
    }

    let content: Content
    let copyText: String
    let accessibility: ReviewContentAttachmentAccessibility
    @MainActor weak var selectionTextView: ReviewSelectionTextView?
    // TextKit creates a provider, and so a hosted view, per layout of this attachment; state that
    // must outlive one provider lives in the content's state objects, not in a hosted view.
    @MainActor private let hostedViews = NSHashTable<UIView>.weakObjects()

    @MainActor
    init(content: Content, copyText: String, accessibility: ReviewContentAttachmentAccessibility) {
        self.content = content
        self.copyText = copyText
        self.accessibility = accessibility
        super.init(data: nil, ofType: Self.contentType)
    }

    required init?(coder: NSCoder) { nil }

    @MainActor
    fileprivate func accessibilityView(in textView: ReviewSelectionTextView) -> UIView? {
        self.hostedViews.allObjects.first { $0.isDescendant(of: textView) }
    }

    @MainActor
    func copyForTableCell() -> ReviewContentAttachment {
        ReviewContentAttachment(content: self.content, copyText: self.copyText, accessibility: self.accessibility)
    }

    @MainActor
    fileprivate func registerHostedView(_ view: UIView) { self.hostedViews.add(view) }

    // The view provider renders the content; form labels must not also draw a fallback file icon.
    nonisolated override func image(for bounds: CGRect, attributes: [NSAttributedString.Key: Any], location: any NSTextLocation, textContainer: NSTextContainer?) -> UIImage? {
        nil
    }

    nonisolated override func viewProvider(for parentView: UIView?, location: any NSTextLocation, textContainer: NSTextContainer?) -> NSTextAttachmentViewProvider? {
        let provider = super.viewProvider(for: parentView, location: location, textContainer: textContainer)
        provider?.tracksTextAttachmentViewBounds = true
        return provider
    }

    @MainActor
    fileprivate func measuredBounds(width: CGFloat, size: CGSize) -> CGRect {
        let scale = max(self.selectionTextView?.traitCollection.displayScale ?? 1, 1)
        return CGRect(origin: .zero, size: CGSize(
            width: (width * scale).rounded(.up) / scale,
            height: (max(size.height, 1) * scale).rounded(.up) / scale
        ))
    }
}

private final class ReviewContentAttachmentProvider: NSTextAttachmentViewProvider {
    @MainActor private var hostingController: UIHostingController<AnyView>?
    #if targetEnvironment(macCatalyst)
    @MainActor private var tableView: ReviewSelectableTableView?
    #endif
    @MainActor private var lastMeasurementWidth: CGFloat?
    @MainActor private var notifiedBoundsByWidth: [CGFloat: CGRect] = [:]
    @MainActor private var isSizeNotificationScheduled = false

    @MainActor
    private func hostedController(content: AnyView) -> UIHostingController<AnyView> {
        if let controller = self.hostingController { return controller }
        let controller = UIHostingController(rootView: AnyView(content
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .onGeometryChange(for: CGSize.self) { proxy in
                proxy.size
            } action: { [weak self] _ in
                self?.scheduleSizeNotification()
            }))
        self.hostingController = controller
        controller.view.backgroundColor = .clear
        controller.view.isAccessibilityElement = false
        return controller
    }

    #if targetEnvironment(macCatalyst)
    @MainActor
    private func nativeTable(rows: [[NSAttributedString]]) -> ReviewSelectableTableView {
        if let table = self.tableView { return table }
        // TextKit sizes the table directly, without running a nested SwiftUI layout around its text cells.
        let table = ReviewSelectableTableView(rows: rows)
        self.tableView = table
        table.onJoinHierarchy = { [weak self] in self?.scheduleSizeNotification() }
        for cell in table.cells.joined() {
            cell.onAttachmentSizeChange = { [weak self, weak table] in
                table?.setNeedsLayout()
                self?.scheduleSizeNotification()
            }
        }
        return table
    }
    #endif

    @MainActor
    private func measuredBounds(width: CGFloat, attachment: ReviewContentAttachment) -> CGRect {
        let proposal = CGSize(width: width, height: .greatestFiniteMagnitude)
        let size: CGSize
        switch attachment.content {
        case .hosted(let content):
            size = self.hostedController(content: content).sizeThatFits(in: proposal)
        #if targetEnvironment(macCatalyst)
        case .table(let rows):
            size = self.nativeTable(rows: rows).sizeThatFits(proposal)
        #endif
        }
        return attachment.measuredBounds(width: width, size: size)
    }

    nonisolated override func loadView() {
        // TextKit's Objective-C callbacks lack the UI host's main-actor annotations.
        nonisolated(unsafe) let provider: ReviewContentAttachmentProvider = self
        MainActor.assumeIsolated {
            guard let attachment = provider.textAttachment as? ReviewContentAttachment else { return }
            let view: UIView
            switch attachment.content {
            case .hosted(let content):
                view = ReviewContentAttachmentHostView(hostingController: provider.hostedController(content: content))
            #if targetEnvironment(macCatalyst)
            case .table(let rows):
                view = provider.nativeTable(rows: rows)
            #endif
            }
            provider.view = view
            attachment.registerHostedView(view)
            attachment.selectionTextView?.rebuildAccessibilityContent()
        }
    }

    nonisolated override func attachmentBounds(for attributes: [NSAttributedString.Key: Any], location: any NSTextLocation, textContainer: NSTextContainer?, proposedLineFragment: CGRect, position: CGPoint) -> CGRect {
        nonisolated(unsafe) let provider: ReviewContentAttachmentProvider = self
        return MainActor.assumeIsolated {
            guard let attachment = provider.textAttachment as? ReviewContentAttachment else { return .zero }
            let width = max(proposedLineFragment.width, 1)
            let bounds = provider.measuredBounds(width: width, attachment: attachment)
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
            let bounds = self.measuredBounds(width: width, attachment: attachment)
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

/// Contains the hosting controller in the view controller that owns the text view, so view controllers
/// in the attachment, such as AVKit's player, present and dismiss full screen from a contained hierarchy.
/// The hosted view is in this view only while the controller is contained, in UIKit's containment order.
private final class ReviewContentAttachmentHostView: UIView {
    private let hostingController: UIHostingController<AnyView>
    #if targetEnvironment(macCatalyst)
    private var isContainmentUpdateScheduled = false
    #endif

    init(hostingController: UIHostingController<AnyView>) {
        self.hostingController = hostingController
        super.init(frame: .zero)
    }

    required init?(coder: NSCoder) { nil }

    // TextKit can discard a fragment's views without moving them, for example while the text view is off screen.
    deinit {
        let controller = self.hostingController
        MainActor.assumeIsolated {
            guard controller.view.superview === self else { return }
            controller.willMove(toParent: nil)
            controller.view.removeFromSuperview()
            controller.removeFromParent()
        }
    }

    /// Points the hosted SwiftUI content does not claim belong to the text view, as they do outside attachments.
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === self ? nil : hit
    }

    override func didMoveToSuperview() {
        super.didMoveToSuperview()
        self.updateContainmentAfterHierarchyChange()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        self.updateContainmentAfterHierarchyChange()
    }

    private func updateContainmentAfterHierarchyChange() {
        #if targetEnvironment(macCatalyst)
        // TextKit can move nested attachments during layout. Hosting appearance must run outside that pass.
        guard self.isContainmentUpdateScheduled == false else { return }
        self.isContainmentUpdateScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.isContainmentUpdateScheduled = false
            self.updateContainment()
        }
        #else
        self.updateContainment()
        #endif
    }

    /// Follows the view's ancestors rather than the window, so a presentation that takes the screen
    /// out of the window keeps the hierarchy that presented it. TextKit can load a second view for the
    /// same provider; the one that last joins a hierarchy owns the controller.
    private func updateContainment() {
        let controller = self.hostingController
        let parent = self.superview.flatMap { superview in
            sequence(first: superview as UIResponder, next: \.next).lazy.compactMap { $0 as? UIViewController }.first
        }
        let ownsController = controller.view.superview === self
        if ownsController, controller.parent === parent { return }
        if ownsController == false, parent == nil { return }
        if controller.parent != nil {
            controller.willMove(toParent: nil)
            controller.view.removeFromSuperview()
            controller.removeFromParent()
        }
        guard let parent else { return }
        parent.addChild(controller)
        controller.view.frame = self.bounds
        controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        self.addSubview(controller.view)
        controller.didMove(toParent: parent)
    }
}
