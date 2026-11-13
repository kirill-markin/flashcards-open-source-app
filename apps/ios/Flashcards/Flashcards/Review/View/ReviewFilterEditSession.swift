struct ReviewFilterEditSession {
    struct Scope: Equatable {
        let workspaceId: String?
        let appliedFilter: ReviewFilter
    }

    private var openingScope: Scope?
    var isPresented: Bool = false
    var draft: ReviewFilter = .allCards

    func displayedFilter(in scope: Scope) -> ReviewFilter {
        self.isPresented && self.openingScope == scope ? self.draft : scope.appliedFilter
    }

    mutating func open(in scope: Scope) {
        self.openingScope = scope
        self.draft = scope.appliedFilter
        self.isPresented = true
    }

    mutating func finish(in scope: Scope) -> ReviewFilter? {
        let openingScope = self.openingScope
        self.openingScope = nil
        self.isPresented = false
        guard openingScope == scope, self.draft != scope.appliedFilter else { return nil }
        return self.draft
    }

    mutating func discardIfScopeChanged(to scope: Scope) {
        guard let openingScope = self.openingScope, openingScope != scope else { return }
        self.openingScope = nil
        self.isPresented = false
    }
}
