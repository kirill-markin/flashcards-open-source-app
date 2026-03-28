package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.notifications.NotificationPermissionPromptState
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationMode
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsSettings
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
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
    private val onSettingsChanged: () -> Unit
) : ViewModel() {
    private val refreshVersion = MutableStateFlow(value = 0)

    val uiState: StateFlow<ReviewNotificationsUiState> = combine(
        workspaceRepository.observeWorkspace(),
        refreshVersion
    ) { workspace, _ ->
        if (workspace == null) {
            return@combine initialReviewNotificationsUiState()
        }

        val promptState = reviewNotificationsStore.loadPromptState()
        ReviewNotificationsUiState(
            workspaceId = workspace.workspaceId,
            workspaceName = workspace.name,
            settings = reviewNotificationsStore.loadSettings(workspaceId = workspace.workspaceId),
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

    fun markSystemPermissionRequested() {
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

    private fun updateSettings(transform: (ReviewNotificationsSettings) -> ReviewNotificationsSettings) {
        val workspaceId = uiState.value.workspaceId ?: return
        val nextSettings = transform(uiState.value.settings)
        reviewNotificationsStore.saveSettings(workspaceId = workspaceId, settings = nextSettings)
        refreshVersion.update { version -> version + 1 }
        onSettingsChanged()
    }
}

fun createReviewNotificationsViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    reviewNotificationsStore: ReviewNotificationsStore,
    onSettingsChanged: () -> Unit
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            ReviewNotificationsViewModel(
                workspaceRepository = workspaceRepository,
                reviewNotificationsStore = reviewNotificationsStore,
                onSettingsChanged = onSettingsChanged
            )
        }
    }
}
