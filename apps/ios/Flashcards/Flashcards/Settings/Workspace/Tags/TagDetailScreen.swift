import SwiftUI

struct TagDetailScreen: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Environment(\.dismiss) private var dismiss

    let tag: String
    let workspaceId: String

    @State private var stats: DeckCardStats?
    @State private var statsLoadFailed = false

    private var isTagAvailable: Bool {
        self.store.workspace?.workspaceId == self.workspaceId && (self.stats?.totalCards ?? 0) > 0
    }

    var body: some View {
        List {
            Section {
                if let stats {
                    LabeledContent(
                        aiSettingsLocalized("settings.workspace.tags.totalCards", "Total cards"),
                        value: stats.totalCards.formatted()
                    )
                    LabeledContent(
                        aiSettingsLocalized("settings.workspace.overview.new", "New"),
                        value: stats.newCards.formatted()
                    )
                    LabeledContent(
                        aiSettingsLocalized("settings.workspace.decks.toStudy", "To study"),
                        value: stats.dueCards.formatted()
                    )
                } else if self.statsLoadFailed {
                    Text(aiSettingsLocalized("common.unavailable", "Unavailable"))
                        .foregroundStyle(.secondary)
                    Button(aiSettingsLocalized("common.retry", "Retry")) {
                        self.reloadStats()
                    }
                } else {
                    ProgressView(aiSettingsLocalized("common.loading", "Loading..."))
                }
            }

            Section {
                Button {
                    self.store.selectReviewFilter(reviewFilter: makeReviewTagsFilter(tags: [self.tag]))
                    self.navigation.selectTab(.review)
                } label: {
                    Label(aiSettingsLocalized("settings.workspace.decks.openReview", "Open review"), systemImage: "rectangle.on.rectangle")
                }
            }
            .disabled(self.isTagAvailable == false)

            Section {
                CardMaintenanceButton(
                    scope: CardMaintenanceScope(workspaceId: self.workspaceId, kind: .resetTag, target: self.tag, expectedDeckFilter: nil),
                    isAvailable: self.isTagAvailable,
                    onDismiss: {},
                    onCompleted: {}
                )
                CardMaintenanceButton(
                    scope: CardMaintenanceScope(workspaceId: self.workspaceId, kind: .removeTag, target: self.tag, expectedDeckFilter: nil),
                    isAvailable: self.isTagAvailable,
                    onDismiss: {},
                    onCompleted: { self.dismiss() }
                )
            }
        }
        .listStyle(.insetGrouped)
        .nativeNavigationTitle(self.tag)
        #if targetEnvironment(macCatalyst)
        .macToolbarContribution(MacToolbarContribution(tab: .library, role: .navigation))
        #else
        .toolbar {
            AICompanionToolbarItem()
        }
        #endif
        .task(id: "\(self.store.localReadVersion)|\(self.store.reviewScheduleVersion)") {
            self.reloadStats()
        }
        .onChange(of: self.store.workspace?.workspaceId) { _, workspaceId in
            if workspaceId != self.workspaceId {
                self.dismiss()
            }
        }
    }

    private func reloadStats() {
        guard self.store.workspace?.workspaceId == self.workspaceId else {
            return
        }

        do {
            let database = try requireLocalDatabase(database: self.store.database)
            self.stats = try database.loadTagCardStats(workspaceId: self.workspaceId, tag: self.tag, now: Date())
            self.statsLoadFailed = false
        } catch {
            self.stats = nil
            self.statsLoadFailed = true
            self.store.presentTechnicalError(error)
        }
    }
}
