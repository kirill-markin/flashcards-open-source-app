package com.flashcardsopensourceapp.feature.settings.accent

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferencesUpdate
import com.flashcardsopensourceapp.data.local.model.sync.defaultAccentColor
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class AccentColorUiState(
    val selectedColor: String,
    val canManagePreferences: Boolean,
    val isSaving: Boolean
)

class AccentColorViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val messageController: TransientMessageController,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val isSaving = MutableStateFlow(false)

    val uiState: StateFlow<AccentColorUiState> = combine(
        cloudAccountRepository.observeAccountPreferences(),
        cloudAccountRepository.observeCloudSettings(),
        isSaving
    ) { preferences, cloudSettings, saving ->
        AccentColorUiState(
            selectedColor = preferences.accentColor,
            canManagePreferences = cloudSettings.cloudState == CloudAccountState.GUEST ||
                cloudSettings.cloudState == CloudAccountState.LINKED,
            isSaving = saving
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = AccentColorUiState(
            selectedColor = defaultAccentColor,
            canManagePreferences = false,
            isSaving = false
        )
    )

    fun selectColor(color: String) {
        if (isSaving.value || uiState.value.canManagePreferences.not()) {
            return
        }
        isSaving.value = true
        viewModelScope.launch {
            try {
                cloudAccountRepository.updateAccountPreferences(
                    update = AccountPreferencesUpdate(
                        accentColor = color,
                        reviewReactionAnimationsEnabled = null,
                        productAnalyticsEnabled = null
                    )
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                messageController.showMessage(message = strings.get(R.string.settings_accent_update_failed))
            } finally {
                isSaving.value = false
            }
        }
    }
}

fun createAccentColorViewModelFactory(
    cloudAccountRepository: CloudAccountRepository,
    messageController: TransientMessageController,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AccentColorViewModel(
                cloudAccountRepository = cloudAccountRepository,
                messageController = messageController,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
