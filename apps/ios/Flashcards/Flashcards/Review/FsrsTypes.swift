import Foundation

/**
 FSRS-facing Swift types mirror the backend scheduler contract plus the web and
 Android transport/data types. The iOS scheduler implementation itself lives in
 `FsrsScheduler.swift`.

 Keep these FSRS-facing types aligned with:
 - apps/backend/src/schedule.ts
 - apps/backend/src/cards.ts
 - apps/backend/src/workspaceSchedulerSettings.ts
 - apps/web/src/types.ts
 - apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/FlashcardsModels.kt
 - docs/fsrs-scheduling-logic.md
 */

// Keep in sync with apps/backend/src/schedule.ts::FsrsCardState, apps/web/src/types.ts::FsrsCardState, and apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/FlashcardsModels.kt::FsrsCardState.
enum FsrsCardState: String, Codable, CaseIterable, Hashable, Identifiable, Sendable {
    case new
    case learning
    case review
    case relearning

    var id: String {
        rawValue
    }
}

// Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::WorkspaceSchedulerSettings, apps/web/src/types.ts::WorkspaceSchedulerSettings, and apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/FlashcardsModels.kt::WorkspaceSchedulerSettings.
struct WorkspaceSchedulerSettings: Codable, Hashable, Sendable {
    let algorithm: String
    let desiredRetention: Double
    let learningStepsMinutes: [Int]
    let relearningStepsMinutes: [Int]
    let maximumIntervalDays: Int
    let enableFuzz: Bool
    let clientUpdatedAt: String
    let lastModifiedByReplicaId: String
    let lastOperationId: String
    let updatedAt: String
}

struct ReviewSchedule: Hashable {
    let dueAt: Date
    let reps: Int
    let lapses: Int
    let fsrsCardState: FsrsCardState
    let fsrsStepIndex: Int?
    let fsrsStability: Double
    let fsrsDifficulty: Double
    let fsrsLastReviewedAt: Date
    let fsrsScheduledDays: Int
}
