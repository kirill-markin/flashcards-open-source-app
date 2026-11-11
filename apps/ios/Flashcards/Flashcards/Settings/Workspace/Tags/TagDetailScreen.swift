import SwiftUI

struct TagDetailScreen: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Environment(\.dismiss) private var dismiss

    let tag: String
    let workspaceId: String

    @State private var snapshot: (stats: DeckCardStats, cards: [Card])?
    @State private var snapshotLoadFailed = false

    private var isCurrentWorkspace: Bool {
        self.store.workspace?.workspaceId == self.workspaceId
    }

    private var isTagAvailable: Bool {
        self.isCurrentWorkspace && (self.snapshot?.stats.totalCards ?? 0) > 0
    }

    var body: some View {
        List {
            Section {
                if let snapshot, self.isCurrentWorkspace {
                    DeckCardSummaryRows(stats: snapshot.stats)
                } else if self.snapshotLoadFailed {
                    Text(aiSettingsLocalized("common.unavailable", "Unavailable"))
                        .foregroundStyle(.secondary)
                    Button(aiSettingsLocalized("common.retry", "Retry")) {
                        self.reloadSnapshot()
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

            if let snapshot, self.isCurrentWorkspace {
                Section(aiSettingsLocalized("settings.workspace.decks.section.matchingCards", "Matching cards")) {
                    if snapshot.cards.isEmpty {
                        Text(String(localized: "No Matching Cards", table: "ReviewCards"))
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(snapshot.cards) { card in
                            CardRow(card: card)
                        }
                    }
                }
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
            self.reloadSnapshot()
        }
        .onChange(of: self.store.workspace?.workspaceId) { _, workspaceId in
            if workspaceId != self.workspaceId {
                self.dismiss()
            }
        }
    }

    private func reloadSnapshot() {
        guard self.isCurrentWorkspace else {
            return
        }

        do {
            let database = try requireLocalDatabase(database: self.store.database)
            self.snapshot = try database.loadTagDetailSnapshot(workspaceId: self.workspaceId, tag: self.tag, now: Date())
            self.snapshotLoadFailed = false
        } catch {
            self.snapshot = nil
            self.snapshotLoadFailed = true
            self.store.presentTechnicalError(error)
        }
    }
}
