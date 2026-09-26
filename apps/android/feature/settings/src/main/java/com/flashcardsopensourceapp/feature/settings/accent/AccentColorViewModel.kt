package com.flashcardsopensourceapp.feature.settings.accent

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferencesUpdate
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class AccentColorUiState(
    val selectedColor: String,
    val identityKey: String,
    val canManagePreferences: Boolean,
    val isSaving: Boolean,
    val errorMessage: String?
)

private data class PendingAccentColor(val color: String, val identityKey: String)
private data class AccentColorSaveError(val message: String, val identityKey: String)

class AccentColorViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val preferencesStore: CloudPreferencesStore,
    private val operationCoordinator: CloudOperationCoordinator,
    private val messageController: TransientMessageController,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val pendingColor = MutableStateFlow<PendingAccentColor?>(null)
    private val saveError = MutableStateFlow<AccentColorSaveError?>(null)
    private var saveJob: Job? = null

    val uiState: StateFlow<AccentColorUiState> = combine(
        cloudAccountRepository.observeAccountPreferences(),
        cloudAccountRepository.observeCloudSettings(),
        pendingColor,
        saveError
    ) { _, cloudSettings, pending, error ->
        val identityKey = accentIdentityKey(settings = cloudSettings)
        val activePending = pending?.takeIf { it.identityKey == identityKey }
        AccentColorUiState(
            selectedColor = activePending?.color ?: preferencesStore.currentAccountPreferences().accentColor,
            identityKey = identityKey,
            canManagePreferences = cloudSettings.cloudState == CloudAccountState.GUEST ||
                cloudSettings.cloudState == CloudAccountState.LINKED,
            isSaving = activePending != null,
            errorMessage = error?.takeIf { it.identityKey == identityKey }?.message
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = AccentColorUiState(
            selectedColor = preferencesStore.currentAccountPreferences().accentColor,
            identityKey = accentIdentityKey(settings = preferencesStore.currentCloudSettings()),
            canManagePreferences = false,
            isSaving = false,
            errorMessage = null
        )
    )

    fun selectColor(color: String, identityKey: String) {
        val settings = preferencesStore.currentCloudSettings()
        if (identityKey != accentIdentityKey(settings = settings) ||
            (settings.cloudState != CloudAccountState.GUEST && settings.cloudState != CloudAccountState.LINKED)
        ) {
            return
        }
        require(Regex("^#[0-9A-F]{6}$").matches(color)) { "Accent color must be uppercase #RRGGBB." }
        saveError.value = null
        if (pendingColor.value == null && color == preferencesStore.currentAccountPreferences().accentColor) {
            return
        }
        pendingColor.value = PendingAccentColor(color = color, identityKey = identityKey)
        if (saveJob?.isActive == true) {
            return
        }
        saveJob = viewModelScope.launch {
            while (pendingColor.value != null) {
                // One latest value, at most four writes per second; screen dismissal does not cancel it.
                delay(250L)
                val requested = pendingColor.value ?: break
                try {
                    operationCoordinator.runExclusive {
                        check(requested.identityKey == accentIdentityKey(settings = preferencesStore.currentCloudSettings())) {
                            "Account changed before the accent color could be saved."
                        }
                        cloudAccountRepository.updateAccountPreferences(
                            update = AccountPreferencesUpdate(
                                accentColor = requested.color,
                                reviewReactionAnimationsEnabled = null,
                                productAnalyticsEnabled = null
                            )
                        )
                    }
                    if (pendingColor.value == requested) {
                        pendingColor.value = null
                        saveError.value = null
                    }
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    if (pendingColor.value == requested) {
                        pendingColor.value = null
                    }
                    if (requested.identityKey == accentIdentityKey(settings = preferencesStore.currentCloudSettings())) {
                        val message = strings.get(R.string.settings_accent_update_failed)
                        saveError.value = AccentColorSaveError(message = message, identityKey = requested.identityKey)
                        messageController.showMessage(message = message)
                    }
                }
            }
        }
    }
}

private fun accentIdentityKey(settings: CloudSettings): String {
    return "${settings.installationId}:${settings.cloudState}:${settings.linkedUserId}"
}

fun createAccentColorViewModelFactory(
    cloudAccountRepository: CloudAccountRepository,
    preferencesStore: CloudPreferencesStore,
    operationCoordinator: CloudOperationCoordinator,
    messageController: TransientMessageController,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AccentColorViewModel(
                cloudAccountRepository = cloudAccountRepository,
                preferencesStore = preferencesStore,
                operationCoordinator = operationCoordinator,
                messageController = messageController,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
