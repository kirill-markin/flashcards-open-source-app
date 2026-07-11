package com.flashcardsopensourceapp.feature.settings.review

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.notifications.NotificationPermissionPromptState
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationMode
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsSettings
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersSettings
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersStore
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

class ReviewNotificationsViewModel(
    private val workspaceRepository: WorkspaceRepository,
    private val reviewNotificationsStore: ReviewNotificationsStore,
    private val strictRemindersStore: StrictRemindersStore,
    private val onReviewSettingsChanged: () -> Unit,
    private val onStrictRemindersSettingsChanged: (Boolean) -> Unit,
    private val onAppIconBadgeDisabled: () -> Unit
) : ViewModel() {
    private val refreshVersion = MutableStateFlow(value = 0)

    val uiState: StateFlow<ReviewNotificationsUiState> = combine(
        workspaceRepository.observeWorkspace(),
        refreshVersion
    ) { workspace, _ ->
        if (workspace == null) {
            return@combine initialReviewNotificationsUiState()
        }

        reviewNotificationsStore.migrateLegacySettings(currentWorkspaceId = workspace.workspaceId)
        val promptState = reviewNotificationsStore.loadPromptState()
        ReviewNotificationsUiState(
            isLoaded = true,
            settings = reviewNotificationsStore.loadSettings(),
            strictRemindersSettings = strictRemindersStore.loadStrictRemindersSettings(),
            hasRequestedSystemPermission = promptState.hasRequestedSystemPermission
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = initialReviewNotificationsUiState()
    )

    fun updateEnabled(isEnabled: Boolean) {
        updateSettings { settings ->
            settings.copy(isEnabled = isEnabled)
        }
    }

    fun updateMode(mode: ReviewNotificationMode) {
        updateSettings { settings ->
            settings.copy(selectedMode = mode)
        }
    }

    fun updateDailyTime(hour: Int, minute: Int) {
        updateSettings { settings ->
            settings.copy(
                daily = settings.daily.copy(
                    hour = hour,
                    minute = minute
                )
            )
        }
    }

    fun updateInactivityWindowStart(hour: Int, minute: Int) {
        updateSettings { settings ->
            settings.copy(
                inactivity = settings.inactivity.copy(
                    windowStartHour = hour,
                    windowStartMinute = minute
                )
            )
        }
    }

    fun updateInactivityWindowEnd(hour: Int, minute: Int) {
        updateSettings { settings ->
            settings.copy(
                inactivity = settings.inactivity.copy(
                    windowEndHour = hour,
                    windowEndMinute = minute
                )
            )
        }
    }

    fun updateIdleMinutes(idleMinutes: Int) {
        updateSettings { settings ->
            settings.copy(
                inactivity = settings.inactivity.copy(idleMinutes = idleMinutes)
            )
        }
    }

    fun updateShowAppIconBadge(value: Boolean) {
        val didUpdate = updateSettings { settings ->
            settings.copy(showAppIconBadge = value)
        }
        // When the toggle is turned off, drop any badge currently shown so the
        // user gets immediate feedback rather than waiting for a future event.
        if (didUpdate && value.not()) {
            onAppIconBadgeDisabled()
        }
    }

    fun updateStrictRemindersEnabled(isEnabled: Boolean) {
        if (uiState.value.isLoaded.not()) {
            return
        }
        val nextSettings = StrictRemindersSettings(isEnabled = isEnabled)
        strictRemindersStore.saveStrictRemindersSettings(settings = nextSettings)
        refreshVersion.update { version -> version + 1 }
        onStrictRemindersSettingsChanged(isEnabled)
    }

    fun markSystemPermissionRequested() {
        if (uiState.value.isLoaded.not()) {
            return
        }
        val promptState = reviewNotificationsStore.loadPromptState()
        reviewNotificationsStore.savePromptState(
            state = NotificationPermissionPromptState(
                hasShownPrePrompt = promptState.hasShownPrePrompt,
                hasRequestedSystemPermission = true,
                hasDismissedPrePrompt = promptState.hasDismissedPrePrompt
            )
        )
        refreshVersion.update { version -> version + 1 }
    }

    private fun updateSettings(
        transform: (ReviewNotificationsSettings) -> ReviewNotificationsSettings
    ): Boolean {
        if (uiState.value.isLoaded.not()) {
            return false
        }
        val nextSettings = transform(uiState.value.settings)
        reviewNotificationsStore.saveSettings(settings = nextSettings)
        refreshVersion.update { version -> version + 1 }
        onReviewSettingsChanged()
        return true
    }
}

fun createReviewNotificationsViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    reviewNotificationsStore: ReviewNotificationsStore,
    strictRemindersStore: StrictRemindersStore,
    onReviewSettingsChanged: () -> Unit,
    onStrictRemindersSettingsChanged: (Boolean) -> Unit,
    onAppIconBadgeDisabled: () -> Unit
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            ReviewNotificationsViewModel(
                workspaceRepository = workspaceRepository,
                reviewNotificationsStore = reviewNotificationsStore,
                strictRemindersStore = strictRemindersStore,
                onReviewSettingsChanged = onReviewSettingsChanged,
                onStrictRemindersSettingsChanged = onStrictRemindersSettingsChanged,
                onAppIconBadgeDisabled = onAppIconBadgeDisabled
            )
        }
    }
}
