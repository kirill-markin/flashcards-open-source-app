import SwiftUI

/// Cards list state owned by the app, so a recreated `CardsScreen` keeps the search,
/// the applied filter, the last loaded list, and the scroll position.
@MainActor
@Observable
final class CardsScreenModel {
    /// A new query starts from the top of its results.
    var searchText: String {
        didSet {
            if self.searchText != oldValue {
                self.listTopCardId = nil
            }
        }
    }
    var committedFilter: CardFilter? {
        didSet {
            if self.committedFilter != oldValue {
                self.listTopCardId = nil
            }
        }
    }
    var loadedSnapshot: LoadedCardsListSnapshot?
    /// First visible card of the last settled scroll; nil at the top of the list.
    var listTopCardId: String?
    /// Workspace the state above belongs to; its tags and cards mean nothing in another one.
    @ObservationIgnored private var workspaceId: String?

    init() {
        self.searchText = ""
        self.committedFilter = nil
        self.loadedSnapshot = nil
        self.listTopCardId = nil
        self.workspaceId = nil
    }

    /// Call before reading the query, so another workspace never loads with the previous one's.
    func adoptWorkspace(workspaceId: String) {
        guard self.workspaceId != workspaceId else {
            return
        }
        if self.workspaceId != nil {
            self.searchText = ""
            self.committedFilter = nil
            self.loadedSnapshot = nil
            self.listTopCardId = nil
        }
        self.workspaceId = workspaceId
    }
}

struct LoadedCardsListSnapshot {
    /// A snapshot read from another workspace must not be shown, even briefly.
    let workspaceId: String?
    let snapshot: CardsListSnapshot
}
