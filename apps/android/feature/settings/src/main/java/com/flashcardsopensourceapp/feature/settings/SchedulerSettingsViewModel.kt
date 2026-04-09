package com.flashcardsopensourceapp.feature.settings

import android.content.Context
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
    private val workspaceRepository: WorkspaceRepository,
    private val strings: SettingsStringResolver
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
                updatedAtLabel = strings.get(R.string.settings_unavailable),
                errorMessage = draft.errorMessage,
                showSaveConfirmation = draft.showSaveConfirmation
            )
        }

        val resolvedSettings = schedulerSettings
        val effectiveDraft = if (draft.hasUserEdits) {
            draft
        } else {
            makeDraftState(settings = resolvedSettings, strings = strings)
        }

        SchedulerSettingsUiState(
            isLoading = false,
            algorithm = resolvedSettings.algorithm.uppercase(),
            desiredRetentionText = effectiveDraft.desiredRetentionText,
            learningStepsText = effectiveDraft.learningStepsText,
            relearningStepsText = effectiveDraft.relearningStepsText,
            maximumIntervalDaysText = effectiveDraft.maximumIntervalDaysText,
            enableFuzz = effectiveDraft.enableFuzz,
            updatedAtLabel = formatWorkspaceSchedulerUpdatedAtLabel(
                updatedAtMillis = resolvedSettings.updatedAtMillis,
                strings = strings
            ),
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
            updatedAtLabel = strings.get(R.string.settings_unavailable),
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
            parseSchedulerInput(draft = draft, strings = strings)
            draftState.update { state ->
                state.copy(showSaveConfirmation = true, errorMessage = "")
            }
        } catch (error: IllegalArgumentException) {
            draftState.update { state ->
                state.copy(errorMessage = error.message ?: strings.get(R.string.settings_scheduler_invalid))
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
            parseSchedulerInput(draft = draft, strings = strings)
        } catch (error: IllegalArgumentException) {
            draftState.update { state ->
                state.copy(
                    errorMessage = error.message ?: strings.get(R.string.settings_scheduler_invalid),
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
            ),
            strings = strings
        ).copy(hasUserEdits = true)
    }
}

fun createSchedulerSettingsViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            SchedulerSettingsViewModel(
                workspaceRepository = workspaceRepository,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}

private fun makeDraftState(
    settings: WorkspaceSchedulerSettings,
    strings: SettingsStringResolver
): SchedulerSettingsDraftState {
    return SchedulerSettingsDraftState(
        desiredRetentionText = formatWorkspaceSchedulerDesiredRetention(
            value = settings.desiredRetention,
            strings = strings
        ),
        learningStepsText = settings.learningStepsMinutes.joinToString(separator = ", "),
        relearningStepsText = settings.relearningStepsMinutes.joinToString(separator = ", "),
        maximumIntervalDaysText = settings.maximumIntervalDays.toString(),
        enableFuzz = settings.enableFuzz,
        errorMessage = "",
        showSaveConfirmation = false,
        hasUserEdits = false
    )
}

private fun parseSchedulerInput(
    draft: SchedulerSettingsDraftState,
    strings: SettingsStringResolver
): ParsedSchedulerInput {
    val desiredRetention = draft.desiredRetentionText.trim().replace(oldValue = ",", newValue = ".").toDoubleOrNull()
        ?: throw IllegalArgumentException(strings.get(R.string.settings_scheduler_desired_retention_invalid))
    val learningSteps = parseStepList(
        text = draft.learningStepsText,
        fieldName = strings.get(R.string.settings_scheduler_field_learning_steps),
        strings = strings
    )
    val relearningSteps = parseStepList(
        text = draft.relearningStepsText,
        fieldName = strings.get(R.string.settings_scheduler_field_relearning_steps),
        strings = strings
    )
    val maximumIntervalDays = draft.maximumIntervalDaysText.trim().toIntOrNull()
        ?: throw IllegalArgumentException(strings.get(R.string.settings_scheduler_max_interval_invalid))

    if (desiredRetention <= 0 || desiredRetention >= 1) {
        throw IllegalArgumentException(strings.get(R.string.settings_scheduler_desired_retention_range_invalid))
    }
    if (maximumIntervalDays <= 0) {
        throw IllegalArgumentException(strings.get(R.string.settings_scheduler_max_interval_invalid))
    }

    return ParsedSchedulerInput(
        desiredRetention = desiredRetention,
        learningStepsMinutes = learningSteps,
        relearningStepsMinutes = relearningSteps,
        maximumIntervalDays = maximumIntervalDays,
        enableFuzz = draft.enableFuzz
    )
}

private fun parseStepList(
    text: String,
    fieldName: String,
    strings: SettingsStringResolver
): List<Int> {
    val values = text.split(",").mapNotNull { rawValue ->
        val trimmedValue = rawValue.trim()
        if (trimmedValue.isEmpty()) {
            null
        } else {
            trimmedValue.toIntOrNull()
                ?: throw IllegalArgumentException(
                    strings.get(R.string.settings_scheduler_steps_invalid_integers, fieldName)
                )
        }
    }

    if (values.isEmpty()) {
        throw IllegalArgumentException(
            strings.get(R.string.settings_scheduler_steps_invalid_empty, fieldName)
        )
    }
    if (values.any { value -> value <= 0 }) {
        throw IllegalArgumentException(
            strings.get(R.string.settings_scheduler_steps_invalid_positive, fieldName)
        )
    }

    return values
}
