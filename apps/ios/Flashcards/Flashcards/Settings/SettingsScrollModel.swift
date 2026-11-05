import Observation
import SwiftUI

/// The top visible row of each Settings and Library list, owned by the app so a recreated stack
/// reopens each list where the person left it; `nil` is the list's top.
@MainActor
@Observable
final class SettingsScrollModel {
    var settingsTopRowID: String? = nil
    var decksTopRowID: String? = nil
    var tagsTopRowID: String? = nil

    /// Call on every Library path change. A pushed list can leave the path while hidden, with no
    /// `onDisappear` of its own, so the path decides, and the next push starts at the top.
    func forgetRowsOffLibraryPath(navigation: AppNavigationModel) {
        if navigation.isDecksOnLibraryPath == false {
            self.decksTopRowID = nil
        }
        if navigation.isTagsOnLibraryPath == false {
            self.tagsTopRowID = nil
        }
    }

    /// Writes only while the list is on the path, because the outgoing list keeps reporting rows
    /// through its pop animation, after `forgetRowsOffLibraryPath` has run.
    func topRowID(
        _ row: ReferenceWritableKeyPath<SettingsScrollModel, String?>,
        whileOnPath isOnPath: @escaping () -> Bool
    ) -> Binding<String?> {
        Binding(
            get: { self[keyPath: row] },
            set: { rowID in
                if isOnPath() {
                    self[keyPath: row] = rowID
                }
            }
        )
    }
}

extension View {
    /// Apply to a `List` whose rows use `rememberedListRow(id:)`. A `List` ignores
    /// `ScrollPosition`, so this restores the remembered row through `ScrollViewReader`.
    func rememberedListScroll(topRowID: Binding<String?>, isContentReady: Bool) -> some View {
        self.modifier(RememberedListScroll(topRowID: topRowID, isContentReady: isContentReady))
    }

    func rememberedListRow(id: String) -> some View {
        // Outside the modifier, so the list knows the identity of rows it has not built yet.
        self.modifier(RememberedListRow(id: id)).id(id)
    }
}

private struct RememberedListContext {
    /// Global y of the list's top content edge, below its bars.
    let topEdge: CGFloat
    let reportTopRow: (String) -> Void
}

extension EnvironmentValues {
    @Entry fileprivate var rememberedListContext: RememberedListContext? = nil
}

private struct ListScrollLayout: Equatable {
    let contentHeight: CGFloat
    let isAtTop: Bool
}

private struct RememberedListScroll: ViewModifier {
    @Binding var topRowID: String?
    let isContentReady: Bool

    @State private var listTop: CGFloat = 0
    @State private var contentHeight: CGFloat = 0
    @State private var isRestored: Bool = false
    @State private var isAtTop: Bool = true

    func body(content: Content) -> some View {
        ScrollViewReader { proxy in
            content
                .environment(\.rememberedListContext, RememberedListContext(
                    // The layout frame already starts below the bars; adding the content insets counts them twice.
                    topEdge: self.listTop,
                    reportTopRow: { rowID in
                        // Before the restore the first row is on top and would replace the remembered one.
                        // At the top `nil` is remembered instead, because no row holds the top edge there.
                        guard self.isRestored, self.isAtTop == false else {
                            return
                        }
                        self.topRowID = rowID
                    }
                ))
                .onGeometryChange(for: CGFloat.self) { geometry in
                    geometry.frame(in: .global).minY
                } action: { listTop in
                    self.listTop = listTop
                }
                .onScrollGeometryChange(for: ListScrollLayout.self) { geometry in
                    ListScrollLayout(
                        contentHeight: geometry.contentSize.height,
                        isAtTop: geometry.contentOffset.y + geometry.contentInsets.top <= 0
                    )
                } action: { oldLayout, layout in
                    self.isAtTop = layout.isAtTop
                    if self.isRestored {
                        // Only on arrival, so a layout pass before the restored scroll lands keeps the row.
                        if layout.isAtTop && oldLayout.isAtTop == false {
                            self.topRowID = nil
                        }
                    } else {
                        self.contentHeight = layout.contentHeight
                        self.restoreIfReady(proxy: proxy)
                    }
                }
                .onChange(of: self.isContentReady) {
                    self.restoreIfReady(proxy: proxy)
                }
        }
    }

    /// A list ignores a scroll request made before it lays out, so this waits for real content.
    private func restoreIfReady(proxy: ScrollViewProxy) {
        guard self.isRestored == false, self.isContentReady, self.contentHeight > 0 else {
            return
        }
        self.isRestored = true
        if let topRowID = self.topRowID {
            proxy.scrollTo(topRowID, anchor: .top)
        }
    }
}

private struct RememberedListRow: ViewModifier {
    @Environment(\.rememberedListContext) private var context: RememberedListContext?
    let id: String

    func body(content: Content) -> some View {
        if let context {
            content
                .onGeometryChange(for: Bool.self) { [topEdge = context.topEdge] geometry in
                    let frame = geometry.frame(in: .global)
                    return frame.minY <= topEdge && frame.maxY > topEdge
                } action: { isTopRow in
                    if isTopRow {
                        context.reportTopRow(self.id)
                    }
                }
        } else {
            content
        }
    }
}
