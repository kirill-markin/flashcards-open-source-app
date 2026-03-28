package com.flashcardsopensourceapp.feature.settings

data class SchedulerSettingsUiState(
    val isLoading: Boolean,
    val algorithm: String,
    val desiredRetentionText: String,
    val learningStepsText: String,
    val relearningStepsText: String,
    val maximumIntervalDaysText: String,
    val enableFuzz: Boolean,
    val updatedAtLabel: String,
    val errorMessage: String,
    val showSaveConfirmation: Boolean
)
