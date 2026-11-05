package com.flashcardsopensourceapp.feature.settings.theme

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferencesUpdate
import com.flashcardsopensourceapp.data.local.model.sync.AccountTheme
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.accountPreferencesIdentityKey
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class ThemeUiState(
    /** The saved theme, or the one being saved; the displayed theme also depends on Premium. */
    val selectedTheme: AccountTheme,
    val identityKey: String,
    val canManagePreferences: Boolean,
    val isSaving: Boolean,
    val errorMessage: String?
)

private data class PendingTheme(val theme: AccountTheme, val identityKey: String)
private data class ThemeSaveError(val message: String, val identityKey: String)

class ThemeViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val preferencesStore: CloudPreferencesStore,
    private val operationCoordinator: CloudOperationCoordinator,
    private val messageController: TransientMessageController,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val pendingTheme = MutableStateFlow<PendingTheme?>(null)
    private val saveError = MutableStateFlow<ThemeSaveError?>(null)
    private var saveJob: Job? = null

    val uiState: StateFlow<ThemeUiState> = combine(
        cloudAccountRepository.observeAccountPreferences(),
        cloudAccountRepository.observeCloudSettings(),
        pendingTheme,
        saveError
    ) { preferences, cloudSettings, pending, error ->
        val identityKey = accountPreferencesIdentityKey(settings = cloudSettings)
        val activePending = pending?.takeIf { it.identityKey == identityKey }
        ThemeUiState(
            selectedTheme = activePending?.theme ?: preferences.theme,
            identityKey = identityKey,
            canManagePreferences = cloudSettings.cloudState == CloudAccountState.GUEST ||
                cloudSettings.cloudState == CloudAccountState.LINKED,
            isSaving = activePending != null,
            errorMessage = error?.takeIf { it.identityKey == identityKey }?.message
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = ThemeUiState(
            selectedTheme = preferencesStore.currentAccountPreferences().theme,
            identityKey = accountPreferencesIdentityKey(settings = preferencesStore.currentCloudSettings()),
            canManagePreferences = false,
            isSaving = false,
            errorMessage = null
        )
    )

    fun selectTheme(theme: AccountTheme, identityKey: String) {
        val settings = preferencesStore.currentCloudSettings()
        if (identityKey != accountPreferencesIdentityKey(settings = settings) ||
            (settings.cloudState != CloudAccountState.GUEST && settings.cloudState != CloudAccountState.LINKED)
        ) {
            return
        }
        saveError.value = null
        if (pendingTheme.value == null && theme == preferencesStore.currentAccountPreferences().theme) {
            return
        }
        pendingTheme.value = PendingTheme(theme = theme, identityKey = identityKey)
        if (saveJob?.isActive == true) {
            return
        }
        saveJob = viewModelScope.launch {
            // Saves the latest choice; screen dismissal does not cancel it.
            while (pendingTheme.value != null) {
                val requested = pendingTheme.value ?: break
                try {
                    operationCoordinator.runExclusive {
                        check(requested.identityKey == accountPreferencesIdentityKey(settings = preferencesStore.currentCloudSettings())) {
                            "Account changed before the theme could be saved."
                        }
                        cloudAccountRepository.updateAccountPreferences(
                            update = AccountPreferencesUpdate(
                                accentColor = null,
                                theme = requested.theme,
                                reviewReactionAnimationsEnabled = null,
                                productAnalyticsEnabled = null,
                                locale = null,
                                firstReviewOnboardingCompleted = null
                            )
                        )
                    }
                    if (pendingTheme.value == requested) {
                        pendingTheme.value = null
                        saveError.value = null
                    }
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    if (pendingTheme.value == requested) {
                        pendingTheme.value = null
                    }
                    if (requested.identityKey == accountPreferencesIdentityKey(settings = preferencesStore.currentCloudSettings())) {
                        val message = strings.get(R.string.settings_theme_update_failed)
                        saveError.value = ThemeSaveError(message = message, identityKey = requested.identityKey)
                        messageController.showMessage(message = message)
                    }
                }
            }
        }
    }
}

fun createThemeViewModelFactory(
    cloudAccountRepository: CloudAccountRepository,
    preferencesStore: CloudPreferencesStore,
    operationCoordinator: CloudOperationCoordinator,
    messageController: TransientMessageController,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            ThemeViewModel(
                cloudAccountRepository = cloudAccountRepository,
                preferencesStore = preferencesStore,
                operationCoordinator = operationCoordinator,
                messageController = messageController,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
