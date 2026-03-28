package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

private data class SchedulerSettingsDraftState(
    val desiredRetentionText: String,
    val learningStepsText: String,
    val relearningStepsText: String,
    val maximumIntervalDaysText: String,
    val enableFuzz: Boolean,
    val errorMessage: String,
    val showSaveConfirmation: Boolean,
    val hasUserEdits: Boolean
)

private data class ParsedSchedulerInput(
    val desiredRetention: Double,
    val learningStepsMinutes: List<Int>,
    val relearningStepsMinutes: List<Int>,
    val maximumIntervalDays: Int,
    val enableFuzz: Boolean
)

class SchedulerSettingsViewModel(
    private val workspaceRepository: WorkspaceRepository
) : ViewModel() {
    private val schedulerSettingsState = workspaceRepository.observeWorkspaceSchedulerSettings().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = null
    )
    private val draftState = MutableStateFlow(
        value = SchedulerSettingsDraftState(
            desiredRetentionText = "",
            learningStepsText = "",
            relearningStepsText = "",
            maximumIntervalDaysText = "",
            enableFuzz = true,
            errorMessage = "",
            showSaveConfirmation = false,
            hasUserEdits = false
        )
    )

    val uiState: StateFlow<SchedulerSettingsUiState> = combine(
        schedulerSettingsState,
        draftState
    ) { schedulerSettings, draft ->
        if (schedulerSettings == null) {
            return@combine SchedulerSettingsUiState(
                isLoading = true,
                algorithm = "FSRS-6",
                desiredRetentionText = draft.desiredRetentionText,
                learningStepsText = draft.learningStepsText,
                relearningStepsText = draft.relearningStepsText,
                maximumIntervalDaysText = draft.maximumIntervalDaysText,
                enableFuzz = draft.enableFuzz,
                updatedAtLabel = "Unavailable",
                errorMessage = draft.errorMessage,
                showSaveConfirmation = draft.showSaveConfirmation
            )
        }

        val resolvedSettings = schedulerSettings
        val effectiveDraft = if (draft.hasUserEdits) {
            draft
        } else {
            makeDraftState(settings = resolvedSettings)
        }

        SchedulerSettingsUiState(
            isLoading = false,
            algorithm = resolvedSettings.algorithm.uppercase(),
            desiredRetentionText = effectiveDraft.desiredRetentionText,
            learningStepsText = effectiveDraft.learningStepsText,
            relearningStepsText = effectiveDraft.relearningStepsText,
            maximumIntervalDaysText = effectiveDraft.maximumIntervalDaysText,
            enableFuzz = effectiveDraft.enableFuzz,
            updatedAtLabel = formatWorkspaceSchedulerUpdatedAtLabel(updatedAtMillis = resolvedSettings.updatedAtMillis),
            errorMessage = effectiveDraft.errorMessage,
            showSaveConfirmation = effectiveDraft.showSaveConfirmation
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = SchedulerSettingsUiState(
            isLoading = true,
            algorithm = "FSRS-6",
            desiredRetentionText = "",
            learningStepsText = "",
            relearningStepsText = "",
            maximumIntervalDaysText = "",
            enableFuzz = true,
            updatedAtLabel = "Unavailable",
            errorMessage = "",
            showSaveConfirmation = false
        )
    )

    fun updateDesiredRetention(text: String) {
        draftState.update { state ->
            state.copy(
                desiredRetentionText = text,
                errorMessage = "",
                hasUserEdits = true
            )
        }
    }

    fun updateLearningSteps(text: String) {
        draftState.update { state ->
            state.copy(
                learningStepsText = text,
                errorMessage = "",
                hasUserEdits = true
            )
        }
    }

    fun updateRelearningSteps(text: String) {
        draftState.update { state ->
            state.copy(
                relearningStepsText = text,
                errorMessage = "",
                hasUserEdits = true
            )
        }
    }

    fun updateMaximumIntervalDays(text: String) {
        draftState.update { state ->
            state.copy(
                maximumIntervalDaysText = text,
                errorMessage = "",
                hasUserEdits = true
            )
        }
    }

    fun updateEnableFuzz(enableFuzz: Boolean) {
        draftState.update { state ->
            state.copy(
                enableFuzz = enableFuzz,
                errorMessage = "",
                hasUserEdits = true
            )
        }
    }

    fun requestSave() {
        val draft = draftState.value

        try {
            parseSchedulerInput(draft = draft)
            draftState.update { state ->
                state.copy(showSaveConfirmation = true, errorMessage = "")
            }
        } catch (error: IllegalArgumentException) {
            draftState.update { state ->
                state.copy(errorMessage = error.message ?: "Scheduler settings are invalid.")
            }
        }
    }

    fun dismissSaveConfirmation() {
        draftState.update { state ->
            state.copy(showSaveConfirmation = false)
        }
    }

    suspend fun save(): Boolean {
        val draft = draftState.value
        val parsedInput = try {
            parseSchedulerInput(draft = draft)
        } catch (error: IllegalArgumentException) {
            draftState.update { state ->
                state.copy(
                    errorMessage = error.message ?: "Scheduler settings are invalid.",
                    showSaveConfirmation = false
                )
            }
            return false
        }

        workspaceRepository.updateWorkspaceSchedulerSettings(
            desiredRetention = parsedInput.desiredRetention,
            learningStepsMinutes = parsedInput.learningStepsMinutes,
            relearningStepsMinutes = parsedInput.relearningStepsMinutes,
            maximumIntervalDays = parsedInput.maximumIntervalDays,
            enableFuzz = parsedInput.enableFuzz
        )
        draftState.update { state ->
            state.copy(
                errorMessage = "",
                showSaveConfirmation = false,
                hasUserEdits = false
            )
        }
        return true
    }

    fun resetToDefaults() {
        val schedulerSettings = schedulerSettingsState.value ?: return
        draftState.value = makeDraftState(
            settings = makeDefaultWorkspaceSchedulerSettings(
                workspaceId = schedulerSettings.workspaceId,
                updatedAtMillis = schedulerSettings.updatedAtMillis
            )
        ).copy(hasUserEdits = true)
    }
}

fun createSchedulerSettingsViewModelFactory(workspaceRepository: WorkspaceRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            SchedulerSettingsViewModel(workspaceRepository = workspaceRepository)
        }
    }
}

private fun makeDraftState(settings: WorkspaceSchedulerSettings): SchedulerSettingsDraftState {
    return SchedulerSettingsDraftState(
        desiredRetentionText = formatWorkspaceSchedulerDesiredRetention(value = settings.desiredRetention),
        learningStepsText = settings.learningStepsMinutes.joinToString(separator = ", "),
        relearningStepsText = settings.relearningStepsMinutes.joinToString(separator = ", "),
        maximumIntervalDaysText = settings.maximumIntervalDays.toString(),
        enableFuzz = settings.enableFuzz,
        errorMessage = "",
        showSaveConfirmation = false,
        hasUserEdits = false
    )
}

private fun parseSchedulerInput(draft: SchedulerSettingsDraftState): ParsedSchedulerInput {
    val desiredRetention = draft.desiredRetentionText.trim().replace(oldValue = ",", newValue = ".").toDoubleOrNull()
        ?: throw IllegalArgumentException("Desired retention must be a decimal number.")
    val learningSteps = parseStepList(
        text = draft.learningStepsText,
        fieldName = "Learning steps"
    )
    val relearningSteps = parseStepList(
        text = draft.relearningStepsText,
        fieldName = "Relearning steps"
    )
    val maximumIntervalDays = draft.maximumIntervalDaysText.trim().toIntOrNull()
        ?: throw IllegalArgumentException("Maximum interval must be a positive integer.")

    if (desiredRetention <= 0 || desiredRetention >= 1) {
        throw IllegalArgumentException("Desired retention must be greater than 0 and less than 1.")
    }
    if (maximumIntervalDays <= 0) {
        throw IllegalArgumentException("Maximum interval must be a positive integer.")
    }

    return ParsedSchedulerInput(
        desiredRetention = desiredRetention,
        learningStepsMinutes = learningSteps,
        relearningStepsMinutes = relearningSteps,
        maximumIntervalDays = maximumIntervalDays,
        enableFuzz = draft.enableFuzz
    )
}

private fun parseStepList(text: String, fieldName: String): List<Int> {
    val values = text.split(",").mapNotNull { rawValue ->
        val trimmedValue = rawValue.trim()
        if (trimmedValue.isEmpty()) {
            null
        } else {
            trimmedValue.toIntOrNull()
                ?: throw IllegalArgumentException("$fieldName must contain integers.")
        }
    }

    if (values.isEmpty()) {
        throw IllegalArgumentException("$fieldName must not be empty.")
    }
    if (values.any { value -> value <= 0 }) {
        throw IllegalArgumentException("$fieldName must contain positive integers.")
    }

    return values
}
