import Foundation

/**
 Local SQLite persistence mirrors the backend FSRS schema closely enough for
 offline-first scheduling. Hidden card scheduler state and the local
 workspaces row are the runtime source of truth on device.

 This file mirrors the backend scheduler-settings and review-persistence logic
 in `apps/backend/src/scheduling/workspaceSettings.ts` and
 `apps/backend/src/cards/review/reviews.ts`.
 If you change scheduler-state validation or review persistence here, make the
 same change in the backend mirror and update docs/fsrs-scheduling-logic.md.

 Source-of-truth docs: docs/fsrs-scheduling-logic.md
 */
final class LocalDatabase {
    let databaseURL: URL
    let core: DatabaseCore
    let cardStore: CardStore
    let deckStore: DeckStore
    let mediaAssetStore: MediaAssetStore
    let mediaTransferStore: MediaTransferStore
    let outboxStore: OutboxStore
    let syncApplier: SyncApplier
    let workspaceSettingsStore: WorkspaceSettingsStore

    convenience init() throws {
        try self.init(core: DatabaseCore())
    }

    convenience init(databaseURL: URL) throws {
        try self.init(core: DatabaseCore(databaseURL: databaseURL))
    }

    convenience init(existingWritableDatabaseURL: URL) throws {
        try self.init(core: DatabaseCore(existingWritableDatabaseURL: existingWritableDatabaseURL))
    }

    private init(core: DatabaseCore) {
        self.databaseURL = core.databaseURL
        self.core = core
        self.cardStore = CardStore(core: core)
        self.deckStore = DeckStore(core: core)
        self.mediaAssetStore = MediaAssetStore(core: core)
        self.mediaTransferStore = MediaTransferStore(core: core)
        self.outboxStore = OutboxStore(core: core)
        self.syncApplier = SyncApplier(core: core)
        self.workspaceSettingsStore = WorkspaceSettingsStore(core: core)
    }

    func close() throws {
        try self.core.close()
    }
}
