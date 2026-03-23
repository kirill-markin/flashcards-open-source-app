package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagsSummary
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

class WorkspaceSettingsViewModel(
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    val uiState: StateFlow<WorkspaceSettingsUiState> = combine(
        workspaceRepository.observeWorkspaceOverview(),
        workspaceRepository.observeWorkspaceSchedulerSettings()
    ) { overview, schedulerSettings ->
        WorkspaceSettingsUiState(
            workspaceName = overview?.workspaceName ?: "Unavailable",
            deckCount = overview?.deckCount ?: 0,
            totalCards = overview?.totalCards ?: 0,
            tagCount = overview?.tagsCount ?: 0,
            schedulerSummary = schedulerSettings?.let(::formatSchedulerSummary) ?: "Unavailable",
            exportSummary = "CSV"
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = WorkspaceSettingsUiState(
            workspaceName = "Loading...",
            deckCount = 0,
            totalCards = 0,
            tagCount = 0,
            schedulerSummary = "Loading...",
            exportSummary = "CSV"
        )
    )
}

class WorkspaceOverviewViewModel(
    workspaceRepository: WorkspaceRepository,
    private val cloudAccountRepository: CloudAccountRepository,
    private val syncRepository: SyncRepository,
    private val messageController: TransientMessageController
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = WorkspaceOverviewDraftState(
            workspaceNameDraft = "",
            hasUserEditedName = false,
            isSavingName = false,
            isDeletePreviewLoading = false,
            isDeletingWorkspace = false,
            deleteState = DestructiveActionState.IDLE,
            errorMessage = "",
            successMessage = "",
            deleteConfirmationText = "",
            showDeletePreviewAlert = false,
            showDeleteConfirmation = false,
            deletePreview = null
        )
    )

    val uiState: StateFlow<WorkspaceOverviewUiState> = combine(
        workspaceRepository.observeWorkspaceOverview(),
        cloudAccountRepository.observeCloudSettings(),
        draftState
    ) { overview, cloudSettings, draft ->
        val workspaceName = overview?.workspaceName ?: "Unavailable"
        val workspaceNameDraft = if (draft.hasUserEditedName) {
            draft.workspaceNameDraft
        } else {
            workspaceName
        }

        WorkspaceOverviewUiState(
            workspaceName = workspaceName,
            totalCards = overview?.totalCards ?: 0,
            deckCount = overview?.deckCount ?: 0,
            tagCount = overview?.tagsCount ?: 0,
            dueCount = overview?.dueCount ?: 0,
            newCount = overview?.newCount ?: 0,
            reviewedCount = overview?.reviewedCount ?: 0,
            isLinked = cloudSettings.cloudState == CloudAccountState.LINKED,
            workspaceNameDraft = workspaceNameDraft,
            isSavingName = draft.isSavingName,
            isDeletePreviewLoading = draft.isDeletePreviewLoading,
            isDeletingWorkspace = draft.isDeletingWorkspace,
            deleteState = draft.deleteState,
            errorMessage = draft.errorMessage,
            successMessage = draft.successMessage,
            deleteConfirmationText = draft.deleteConfirmationText,
            showDeletePreviewAlert = draft.showDeletePreviewAlert,
            showDeleteConfirmation = draft.showDeleteConfirmation,
            deletePreview = draft.deletePreview
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = WorkspaceOverviewUiState(
            workspaceName = "Loading...",
            totalCards = 0,
            deckCount = 0,
            tagCount = 0,
            dueCount = 0,
            newCount = 0,
            reviewedCount = 0,
            isLinked = false,
            workspaceNameDraft = "",
            isSavingName = false,
            isDeletePreviewLoading = false,
            isDeletingWorkspace = false,
            deleteState = DestructiveActionState.IDLE,
            errorMessage = "",
            successMessage = "",
            deleteConfirmationText = "",
            showDeletePreviewAlert = false,
            showDeleteConfirmation = false,
            deletePreview = null
        )
    )

    fun updateWorkspaceNameDraft(name: String) {
        draftState.update { state ->
            state.copy(
                workspaceNameDraft = name,
                hasUserEditedName = true,
                errorMessage = "",
                successMessage = ""
            )
        }
    }

    suspend fun saveWorkspaceName(): Boolean {
        val nextName = uiState.value.workspaceNameDraft.trim()
        if (nextName.isEmpty()) {
            draftState.update { state ->
                state.copy(errorMessage = "Workspace name is required.", successMessage = "")
            }
            return false
        }

        draftState.update { state ->
            state.copy(isSavingName = true, errorMessage = "", successMessage = "")
        }

        return try {
            val renamedWorkspace = cloudAccountRepository.renameCurrentWorkspace(name = nextName)
            draftState.update { state ->
                state.copy(
                    workspaceNameDraft = renamedWorkspace.name,
                    hasUserEditedName = false,
                    isSavingName = false,
                    errorMessage = "",
                    successMessage = "Workspace name saved."
                )
            }
            true
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isSavingName = false,
                    errorMessage = error.message ?: "Workspace rename failed.",
                    successMessage = ""
                )
            }
            false
        }
    }

    suspend fun requestDeleteWorkspace() {
        draftState.update { state ->
            state.copy(
                isDeletePreviewLoading = true,
                deleteState = DestructiveActionState.IDLE,
                errorMessage = "",
                successMessage = ""
            )
        }

        try {
            val deletePreview = cloudAccountRepository.loadCurrentWorkspaceDeletePreview()
            draftState.update { state ->
                state.copy(
                    isDeletePreviewLoading = false,
                    deleteConfirmationText = "",
                    showDeletePreviewAlert = true,
                    showDeleteConfirmation = false,
                    deleteState = DestructiveActionState.IDLE,
                    deletePreview = deletePreview
                )
            }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isDeletePreviewLoading = false,
                    errorMessage = error.message ?: "Workspace deletion preview failed.",
                    successMessage = ""
                )
            }
        }
    }

    fun dismissDeletePreviewAlert() {
        draftState.update { state ->
            state.copy(showDeletePreviewAlert = false)
        }
    }

    fun openDeleteConfirmation() {
        draftState.update { state ->
            state.copy(
                showDeletePreviewAlert = false,
                showDeleteConfirmation = true,
                deleteState = DestructiveActionState.IDLE
            )
        }
    }

    fun updateDeleteConfirmationText(value: String) {
        draftState.update { state ->
            state.copy(
                deleteConfirmationText = value,
                deleteState = if (state.errorMessage.isEmpty()) {
                    state.deleteState
                } else {
                    DestructiveActionState.IDLE
                },
                errorMessage = "",
                successMessage = ""
            )
        }
    }

    fun dismissDeleteConfirmation() {
        draftState.update { state ->
            state.copy(
                showDeleteConfirmation = false,
                deleteConfirmationText = "",
                deleteState = DestructiveActionState.IDLE,
                deletePreview = null
            )
        }
    }

    suspend fun deleteWorkspace(): Boolean {
        val deletePreview = requireNotNull(uiState.value.deletePreview) {
            "Workspace delete preview is required before deletion."
        }
        if (uiState.value.deleteConfirmationText != deletePreview.confirmationText) {
            draftState.update { state ->
                state.copy(errorMessage = "Enter the confirmation phrase exactly to continue.")
            }
            return false
        }

        draftState.update { state ->
            state.copy(
                isDeletingWorkspace = true,
                deleteState = DestructiveActionState.IN_PROGRESS,
                errorMessage = "",
                successMessage = ""
            )
        }

        return try {
            val result = cloudAccountRepository.deleteCurrentWorkspace(
                confirmationText = uiState.value.deleteConfirmationText
            )
            val syncFailureMessage = try {
                syncRepository.syncNow()
                null
            } catch (error: Exception) {
                error.message ?: "Workspace sync failed after deletion."
            }
            draftState.update { state ->
                state.copy(
                    workspaceNameDraft = result.workspace.name,
                    hasUserEditedName = false,
                    isDeletingWorkspace = false,
                    deleteState = DestructiveActionState.IDLE,
                    deleteConfirmationText = "",
                    showDeleteConfirmation = false,
                    deletePreview = null,
                    errorMessage = syncFailureMessage.orEmpty(),
                    successMessage = if (syncFailureMessage == null) {
                        "Workspace deleted. Switched to ${result.workspace.name}."
                    } else {
                        "Workspace deleted. Switched to ${result.workspace.name}. Sync still needs attention."
                    }
                )
            }
            messageController.showMessage(
                message = if (syncFailureMessage == null) {
                    "Workspace deleted. Switched to ${result.workspace.name}."
                } else {
                    "Workspace deleted, but sync still needs attention."
                }
            )
            true
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isDeletingWorkspace = false,
                    deleteState = DestructiveActionState.FAILED,
                    errorMessage = error.message ?: "Workspace deletion failed.",
                    successMessage = ""
                )
            }
            false
        }
    }
}

private data class WorkspaceOverviewDraftState(
    val workspaceNameDraft: String,
    val hasUserEditedName: Boolean,
    val isSavingName: Boolean,
    val isDeletePreviewLoading: Boolean,
    val isDeletingWorkspace: Boolean,
    val deleteState: DestructiveActionState,
    val errorMessage: String,
    val successMessage: String,
    val deleteConfirmationText: String,
    val showDeletePreviewAlert: Boolean,
    val showDeleteConfirmation: Boolean,
    val deletePreview: CloudWorkspaceDeletePreview?
)

class DecksViewModel(
    decksRepository: DecksRepository
) : ViewModel() {
    private val searchQuery = MutableStateFlow(value = "")

    val uiState: StateFlow<DecksUiState> = combine(
        decksRepository.observeDecks(),
        searchQuery
    ) { decks, query ->
        DecksUiState(
            searchQuery = query,
            decks = filterDecks(decks = decks, searchQuery = query)
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = DecksUiState(
            searchQuery = "",
            decks = emptyList()
        )
    )

    fun updateSearchQuery(query: String) {
        searchQuery.value = query
    }
}

class DeckDetailViewModel(
    decksRepository: DecksRepository,
    deckId: String
) : ViewModel() {
    val uiState: StateFlow<DeckDetailUiState> = combine(
        decksRepository.observeDeck(deckId = deckId),
        decksRepository.observeDeckCards(deckId = deckId)
    ) { deck, cards ->
        DeckDetailUiState(
            deck = deck,
            cards = cards
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = DeckDetailUiState(
            deck = null,
            cards = emptyList()
        )
    )
}

class DeckEditorViewModel(
    private val decksRepository: DecksRepository,
    workspaceRepository: WorkspaceRepository,
    editingDeckId: String?
) : ViewModel() {
    private val inputState = MutableStateFlow(
        value = DeckEditorUiState(
            isLoading = true,
            title = if (editingDeckId == null) "New deck" else "Edit deck",
            isEditing = editingDeckId != null,
            name = "",
            selectedEffortLevels = emptyList(),
            selectedTags = emptyList(),
            availableTags = emptyList(),
            errorMessage = ""
        )
    )

    val uiState: StateFlow<DeckEditorUiState> = combine(
        if (editingDeckId == null) {
            flowOf(null)
        } else {
            decksRepository.observeDeck(deckId = editingDeckId)
        },
        workspaceRepository.observeWorkspaceTagsSummary(),
        inputState
    ) { deck, tagsSummary, currentState ->
        currentState.copy(
            isLoading = false,
            availableTags = tagsSummary.tags,
            name = if (currentState.name.isEmpty() && deck != null) deck.name else currentState.name,
            selectedEffortLevels = if (currentState.selectedEffortLevels.isEmpty() && deck != null) {
                deck.filterDefinition.effortLevels
            } else {
                currentState.selectedEffortLevels
            },
            selectedTags = if (currentState.selectedTags.isEmpty() && deck != null) {
                deck.filterDefinition.tags
            } else {
                currentState.selectedTags
            }
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = inputState.value
    )

    fun updateName(name: String) {
        inputState.update { state ->
            state.copy(name = name, errorMessage = "")
        }
    }

    fun toggleEffortLevel(effortLevel: EffortLevel) {
        inputState.update { state ->
            state.copy(
                selectedEffortLevels = toggleEffortLevelSelection(
                    selectedEffortLevels = state.selectedEffortLevels,
                    effortLevel = effortLevel
                ),
                errorMessage = ""
            )
        }
    }

    fun toggleTag(tag: String) {
        inputState.update { state ->
            state.copy(
                selectedTags = toggleTagSelection(
                    selectedTags = state.selectedTags,
                    tag = tag
                ),
                errorMessage = ""
            )
        }
    }

    suspend fun save(editingDeckId: String?): Boolean {
        val state = uiState.value
        val trimmedName = state.name.trim()

        if (trimmedName.isEmpty()) {
            inputState.update { currentState ->
                currentState.copy(errorMessage = "Deck name is required.")
            }
            return false
        }

        val deckDraft = DeckDraft(
            name = trimmedName,
            filterDefinition = buildDeckFilterDefinition(
                effortLevels = state.selectedEffortLevels,
                tags = state.selectedTags
            )
        )

        return if (editingDeckId == null) {
            decksRepository.createDeck(deckDraft = deckDraft)
            true
        } else {
            decksRepository.updateDeck(deckId = editingDeckId, deckDraft = deckDraft)
            true
        }
    }

    suspend fun delete(editingDeckId: String): Boolean {
        decksRepository.deleteDeck(deckId = editingDeckId)
        return true
    }
}

class WorkspaceTagsViewModel(
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    private val searchQuery = MutableStateFlow(value = "")

    val uiState: StateFlow<WorkspaceTagsUiState> = combine(
        workspaceRepository.observeWorkspaceTagsSummary(),
        searchQuery
    ) { tagsSummary, query ->
        WorkspaceTagsUiState(
            searchQuery = query,
            tags = filterTags(
                tags = tagsSummary.tags,
                searchQuery = query
            ),
            totalCards = tagsSummary.totalCards
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = WorkspaceTagsUiState(
            searchQuery = "",
            tags = emptyList(),
            totalCards = 0
        )
    )

    fun updateSearchQuery(query: String) {
        searchQuery.value = query
    }
}

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

class SchedulerSettingsViewModel(
    private val workspaceRepository: WorkspaceRepository
) : ViewModel() {
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
        workspaceRepository.observeWorkspaceSchedulerSettings(),
        draftState
    ) { schedulerSettings, draft ->
        val resolvedSettings = schedulerSettings ?: makeDefaultWorkspaceSchedulerSettings(
            workspaceId = "workspace-demo",
            updatedAtMillis = 0L
        )
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
            updatedAtLabel = formatUpdatedAtLabel(updatedAtMillis = resolvedSettings.updatedAtMillis),
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
        draftState.value = makeDraftState(
            settings = makeDefaultWorkspaceSchedulerSettings(
                workspaceId = "workspace-demo",
                updatedAtMillis = 0L
            )
        ).copy(hasUserEdits = true)
    }
}

fun createWorkspaceSettingsViewModelFactory(workspaceRepository: WorkspaceRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceSettingsViewModel(workspaceRepository = workspaceRepository)
        }
    }
}

fun createWorkspaceOverviewViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository,
    syncRepository: SyncRepository,
    messageController: TransientMessageController
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceOverviewViewModel(
                workspaceRepository = workspaceRepository,
                cloudAccountRepository = cloudAccountRepository,
                syncRepository = syncRepository,
                messageController = messageController
            )
        }
    }
}

fun createDecksViewModelFactory(decksRepository: DecksRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            DecksViewModel(decksRepository = decksRepository)
        }
    }
}

fun createDeckDetailViewModelFactory(decksRepository: DecksRepository, deckId: String): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            DeckDetailViewModel(
                decksRepository = decksRepository,
                deckId = deckId
            )
        }
    }
}

fun createDeckEditorViewModelFactory(
    decksRepository: DecksRepository,
    workspaceRepository: WorkspaceRepository,
    editingDeckId: String?
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            DeckEditorViewModel(
                decksRepository = decksRepository,
                workspaceRepository = workspaceRepository,
                editingDeckId = editingDeckId
            )
        }
    }
}

fun createWorkspaceTagsViewModelFactory(workspaceRepository: WorkspaceRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceTagsViewModel(workspaceRepository = workspaceRepository)
        }
    }
}

fun createSchedulerSettingsViewModelFactory(workspaceRepository: WorkspaceRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            SchedulerSettingsViewModel(workspaceRepository = workspaceRepository)
        }
    }
}

private fun filterDecks(decks: List<DeckSummary>, searchQuery: String): List<DeckSummary> {
    val normalizedQuery = searchQuery.trim().lowercase()

    if (normalizedQuery.isEmpty()) {
        return decks
    }

    return decks.filter { deck ->
        deck.name.lowercase().contains(normalizedQuery)
            || formatDeckFilter(deck.filterDefinition).lowercase().contains(normalizedQuery)
    }
}

private fun filterTags(tags: List<WorkspaceTagSummary>, searchQuery: String): List<WorkspaceTagSummary> {
    val normalizedQuery = searchQuery.trim().lowercase()

    if (normalizedQuery.isEmpty()) {
        return tags
    }

    return tags.filter { tagSummary ->
        tagSummary.tag.lowercase().contains(normalizedQuery)
    }
}

private fun toggleEffortLevelSelection(selectedEffortLevels: List<EffortLevel>, effortLevel: EffortLevel): List<EffortLevel> {
    if (selectedEffortLevels.contains(effortLevel)) {
        return selectedEffortLevels.filter { value ->
            value != effortLevel
        }
    }

    return selectedEffortLevels + effortLevel
}

private fun toggleTagSelection(selectedTags: List<String>, tag: String): List<String> {
    if (selectedTags.contains(tag)) {
        return selectedTags.filter { value ->
            value != tag
        }
    }

    return selectedTags + tag
}

private fun formatDeckFilter(filterDefinition: DeckFilterDefinition): String {
    val parts = buildList {
        if (filterDefinition.effortLevels.isNotEmpty()) {
            add("effort in ${filterDefinition.effortLevels.joinToString(separator = ", ") { effortLevel -> effortLevel.name.lowercase() }}")
        }
        if (filterDefinition.tags.isNotEmpty()) {
            add("tags any of ${filterDefinition.tags.joinToString(separator = ", ")}")
        }
    }

    if (parts.isEmpty()) {
        return "All cards"
    }

    return parts.joinToString(separator = " AND ")
}

private data class ParsedSchedulerInput(
    val desiredRetention: Double,
    val learningStepsMinutes: List<Int>,
    val relearningStepsMinutes: List<Int>,
    val maximumIntervalDays: Int,
    val enableFuzz: Boolean
)

private fun formatSchedulerSummary(settings: WorkspaceSchedulerSettings): String {
    return "${settings.algorithm.uppercase()} ${formatDesiredRetention(settings.desiredRetention)}"
}

private fun formatDesiredRetention(value: Double): String {
    return String.format("%.2f", value)
}

private fun makeDraftState(settings: WorkspaceSchedulerSettings): SchedulerSettingsDraftState {
    return SchedulerSettingsDraftState(
        desiredRetentionText = formatDesiredRetention(value = settings.desiredRetention),
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

private fun formatUpdatedAtLabel(updatedAtMillis: Long): String {
    if (updatedAtMillis <= 0L) {
        return "Unavailable"
    }

    return updatedAtMillis.toString()
}
