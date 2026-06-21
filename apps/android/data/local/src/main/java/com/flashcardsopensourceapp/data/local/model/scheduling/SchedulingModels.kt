package com.flashcardsopensourceapp.data.local.model.scheduling

// Keep in sync with apps/backend/src/scheduling/index.ts::FsrsCardState, apps/web/src/types.ts::FsrsCardState, and apps/ios/Flashcards/Flashcards/Review/Scheduling/FsrsTypes.swift::FsrsCardState.
enum class FsrsCardState {
    NEW,
    LEARNING,
    REVIEW,
    RELEARNING
}

// Keep in sync with apps/backend/src/scheduling/workspaceConfig.ts::WorkspaceSchedulerSettings, apps/web/src/types.ts::WorkspaceSchedulerSettings, and apps/ios/Flashcards/Flashcards/Review/Scheduling/FsrsTypes.swift::WorkspaceSchedulerSettings.
data class WorkspaceSchedulerSettings(
    val workspaceId: String,
    val algorithm: String,
    val desiredRetention: Double,
    val learningStepsMinutes: List<Int>,
    val relearningStepsMinutes: List<Int>,
    val maximumIntervalDays: Int,
    val enableFuzz: Boolean,
    val updatedAtMillis: Long
)
