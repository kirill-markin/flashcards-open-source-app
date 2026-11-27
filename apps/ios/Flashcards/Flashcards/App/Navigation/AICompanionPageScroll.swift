import SwiftUI

/// Owned by the route. Each native section page has its own scroll view for the same side-chat page.
@MainActor
final class AICompanionReadingPosition: Hashable {
    var anchor: AICompanionReadingAnchor?

    nonisolated static func == (lhs: AICompanionReadingPosition, rhs: AICompanionReadingPosition) -> Bool {
        lhs === rhs
    }

    nonisolated func hash(into hasher: inout Hasher) {
        hasher.combine(ObjectIdentifier(self))
    }
}

struct AICompanionSectionPosition {
    let isTop: @MainActor (AppNavigationModel) -> Bool
}

struct AICompanionScrollContext {
    let position: AICompanionReadingPosition
    let isExposed: Bool
    let isActive: @MainActor () -> Bool
}

struct AICompanionScrollTarget: Equatable {
    let id: String
    let source: AICompanionScrollSource?

    func preservesPointOffset(from previous: Self) -> Bool {
        guard self.id == previous.id else { return false }
        switch (self.source, previous.source) {
        case (nil, nil):
            return true
        case (let source?, let previousSource?):
            return source.range.lowerBound == previousSource.range.lowerBound
                && source.text.utf16.starts(with: previousSource.text.utf16)
        default:
            return false
        }
    }
}

struct AICompanionScrollSource: Equatable {
    let text: String
    let range: Range<Int>
    private let lineBoundaries: [Int]

    init(text: String, start: Int) {
        let source = text as NSString
        precondition(source.length > 0)
        var offset = 0
        var lineBoundaries = [start]
        while offset < source.length {
            offset = NSMaxRange(source.lineRange(for: NSRange(location: offset, length: 0)))
            lineBoundaries.append(start + offset)
        }
        self.text = text
        self.range = start..<(start + source.length)
        self.lineBoundaries = lineBoundaries
    }

    // When chunks regroup, explicit lines approximate the rendered position better than UTF-16 length alone.
    func sourceOffset(atRowFraction fraction: CGFloat) -> CGFloat {
        let lineCount = self.lineBoundaries.count - 1
        let position = min(max(fraction, 0), 1) * CGFloat(lineCount)
        let line = min(Int(position), lineCount - 1)
        let start = self.lineBoundaries[line]
        let end = self.lineBoundaries[line + 1]
        return CGFloat(start) + CGFloat(end - start) * (position - CGFloat(line))
    }

    func rowFraction(atSourceOffset offset: CGFloat) -> CGFloat {
        let lineCount = self.lineBoundaries.count - 1
        let position = min(max(offset, CGFloat(self.range.lowerBound)), CGFloat(self.range.upperBound))
        let end = self.lineBoundaries.firstIndex(where: { CGFloat($0) > position }) ?? lineCount
        let start = self.lineBoundaries[end - 1]
        let length = self.lineBoundaries[end] - start
        return (CGFloat(end - 1) + (position - CGFloat(start)) / CGFloat(length)) / CGFloat(lineCount)
    }
}

struct AICompanionReadingAnchor: Equatable {
    let target: AICompanionScrollTarget
    let topOffset: CGFloat
    let sourceOffset: CGFloat?
}

extension EnvironmentValues {
    @Entry var aiCompanionSectionPosition = AICompanionSectionPosition(isTop: { _ in true })
    @Entry var aiCompanionScrollContext: AICompanionScrollContext? = nil
    @Entry fileprivate var aiCompanionScrollLayout: AICompanionScrollLayout? = nil
}

extension View {
    func aiCompanionPageScroll(rowIDs: [String]) -> some View {
        self.aiCompanionPageScroll(targets: rowIDs.map { AICompanionScrollTarget(id: $0, source: nil) })
    }

    func aiCompanionPageScroll(targets: [AICompanionScrollTarget]) -> some View {
        self.modifier(AICompanionPageScroll(targets: targets))
    }

    func aiCompanionScrollRow(id: String) -> some View {
        // Keep the ID outside the modifier so the scroll reader can find an unmounted row.
        self.modifier(AICompanionScrollRow(id: id)).id(id)
    }
}

private struct AICompanionScrollLayout {
    let rows: AIChatScrollRowLayout
    let restore: AICompanionScrollRestore?
    let canRestore: @MainActor () -> Bool
}

private struct AICompanionScrollRestore: Equatable {
    let anchor: AICompanionReadingAnchor
    let target: AICompanionScrollTarget
    let offset: AIChatScrollOffset
}

private struct AICompanionScrollRow: ViewModifier {
    @Environment(\.aiCompanionScrollLayout) private var layout
    let id: String

    func body(content: Content) -> some View {
        if let layout = self.layout {
            content
                .modifier(AIChatScrollRowFrameTracking(
                    rowID: self.id,
                    layout: layout.rows,
                    restoredOffset: layout.restore?.target.id == self.id ? layout.restore?.offset : nil,
                    canRestore: layout.canRestore
                ))
        } else {
            content
        }
    }
}

private struct AICompanionScrollGeometry: Equatable {
    let contentHeight: CGFloat
    let offsetY: CGFloat
}

private struct AICompanionPageScroll: ViewModifier {
    @Environment(\.aiCompanionScrollContext) private var context
    @State private var layout = AIChatScrollRowLayout()
    @State private var restore: AICompanionScrollRestore?
    @State private var isUserScrolling = false
    @State private var contentHeight: CGFloat = 0
    let targets: [AICompanionScrollTarget]

    @ViewBuilder
    func body(content: Content) -> some View {
        if let context = self.context {
            ScrollViewReader { proxy in
                content
                    .environment(\.aiCompanionScrollLayout, AICompanionScrollLayout(
                        rows: self.layout,
                        restore: self.restore,
                        canRestore: { [restore = self.restore] in
                            guard let restore else { return false }
                            return self.isCurrent(restore, context: context)
                        }
                    ))
                    .aiChatScrollViewport(layout: self.layout)
                    .onScrollGeometryChange(for: AICompanionScrollGeometry.self) { geometry in
                        AICompanionScrollGeometry(
                            contentHeight: geometry.containerSize.height > 0 ? geometry.contentSize.height : 0,
                            offsetY: geometry.contentOffset.y
                        )
                    } action: { previous, current in
                        if self.isUserScrolling && previous.offsetY != current.offsetY {
                            self.rememberPosition(context: context)
                        }
                        if self.contentHeight != current.contentHeight {
                            self.contentHeight = current.contentHeight
                            self.scrollToRestoreRow(context: context, proxy: proxy)
                        }
                    }
                    .onScrollPhaseChange { _, phase in
                        guard context.isActive() else {
                            self.isUserScrolling = false
                            return
                        }
                        if phase == .tracking || phase == .interacting || phase == .decelerating {
                            self.restore = nil
                            self.isUserScrolling = true
                        } else if self.isUserScrolling {
                            self.rememberPosition(context: context)
                            self.isUserScrolling = false
                        }
                    }
                    // A native navigation pop can reappear without this pane rendering while covered.
                    .onAppear {
                        self.restorePosition(context: context, proxy: proxy)
                    }
                    .onDisappear {
                        self.restore = nil
                        self.isUserScrolling = false
                    }
                    .onChange(of: context.isExposed) { _, isExposed in
                        self.restore = nil
                        self.isUserScrolling = false
                        if isExposed {
                            self.restorePosition(context: context, proxy: proxy)
                        }
                    }
                    .onChange(of: self.targets) { previous, current in
                        if let request = self.restore, current.contains(where: { $0.id == request.target.id }) == false {
                            self.restore = nil
                            self.layout.resetRestorePlacement()
                        }
                        if let anchor = context.position.anchor,
                           previous.contains(where: { $0.preservesPointOffset(from: anchor.target) }),
                           current.contains(where: { $0.preservesPointOffset(from: anchor.target) }),
                           self.restore == nil || self.restore?.anchor == anchor {
                            return
                        }
                        self.restorePosition(context: context, proxy: proxy)
                    }
            }
        } else {
            content
        }
    }

    private func rememberPosition(context: AICompanionScrollContext) {
        // Query the actual path: an outgoing page can still deliver scroll callbacks during a push or a pop.
        guard context.isActive() else { return }
        guard let row = self.layout.firstVisibleRow(),
              let target = self.targets.first(where: { $0.id == row.id }) else {
            return
        }
        let sourceOffset = target.source?.sourceOffset(atRowFraction: row.topOffset / row.height)
        context.position.anchor = AICompanionReadingAnchor(target: target, topOffset: row.topOffset, sourceOffset: sourceOffset)
    }

    private func resolve(_ anchor: AICompanionReadingAnchor) -> AICompanionScrollRestore? {
        if let target = self.targets.first(where: { $0.preservesPointOffset(from: anchor.target) }) {
            return AICompanionScrollRestore(anchor: anchor, target: target, offset: .points(anchor.topOffset))
        }
        guard let sourceOffset = anchor.sourceOffset,
              let target = self.targets.first(where: { target in
                  target.source.map { CGFloat($0.range.upperBound) > sourceOffset } ?? false
              }) ?? self.targets.last,
              let source = target.source else { return nil }

        return AICompanionScrollRestore(anchor: anchor, target: target, offset: .rowFraction(source.rowFraction(atSourceOffset: sourceOffset)))
    }

    private func isCurrent(_ request: AICompanionScrollRestore, context: AICompanionScrollContext) -> Bool {
        context.isActive() && self.restore == request && context.position.anchor == request.anchor
    }

    private func restorePosition(context: AICompanionScrollContext, proxy: ScrollViewProxy) {
        guard context.isActive(), self.isUserScrolling == false else { return }
        let request = context.position.anchor.flatMap { self.resolve($0) }
        guard self.restore != request else { return }
        self.layout.resetRestorePlacement()
        self.restore = request
        self.scrollToRestoreRow(context: context, proxy: proxy)
    }

    private func scrollToRestoreRow(context: AICompanionScrollContext, proxy: ScrollViewProxy) {
        // ScrollViewReader can only find an offscreen List row once the list has laid out.
        guard self.contentHeight > 0, let request = self.restore else { return }
        DispatchQueue.main.async {
            guard self.contentHeight > 0,
                  self.isCurrent(request, context: context),
                  self.layout.hasPlacedRestoreRow(request.target.id) == false else { return }
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                proxy.scrollTo(request.target.id, anchor: .top)
            }
        }
    }
}
