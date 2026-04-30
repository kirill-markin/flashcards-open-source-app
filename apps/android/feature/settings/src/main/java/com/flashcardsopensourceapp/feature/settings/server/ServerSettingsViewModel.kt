package com.flashcardsopensourceapp.feature.settings.server

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.makeCustomCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

private data class ServerSettingsDraftState(
    val customOrigin: String,
    val previewConfiguration: CloudServiceConfiguration?,
    val isApplying: Boolean,
    val errorMessage: String
)

class ServerSettingsViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = ServerSettingsDraftState(
            customOrigin = "",
            previewConfiguration = null,
            isApplying = false,
            errorMessage = ""
        )
    )

    val uiState: StateFlow<ServerSettingsUiState> = combine(
        cloudAccountRepository.observeServerConfiguration(),
        draftState
    ) { configuration, draft ->
        ServerSettingsUiState(
            modeTitle = when (configuration.mode) {
                CloudServiceConfigurationMode.OFFICIAL -> strings.get(R.string.settings_server_mode_official)
                CloudServiceConfigurationMode.CUSTOM -> strings.get(R.string.settings_server_mode_custom)
            },
            customOrigin = draft.customOrigin,
            apiBaseUrl = configuration.apiBaseUrl,
            authBaseUrl = configuration.authBaseUrl,
            previewApiBaseUrl = draft.previewConfiguration?.apiBaseUrl,
            previewAuthBaseUrl = draft.previewConfiguration?.authBaseUrl,
            isApplying = draft.isApplying,
            errorMessage = draft.errorMessage
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = ServerSettingsUiState(
            modeTitle = strings.get(R.string.settings_loading),
            customOrigin = "",
            apiBaseUrl = "",
            authBaseUrl = "",
            previewApiBaseUrl = null,
            previewAuthBaseUrl = null,
            isApplying = false,
            errorMessage = ""
        )
    )

    suspend fun loadInitialState() {
        val configuration = cloudAccountRepository.currentServerConfiguration()
        draftState.update { state ->
            state.copy(
                customOrigin = configuration.customOrigin.orEmpty(),
                previewConfiguration = configuration.customOrigin?.let { customOrigin ->
                    try {
                        makeCustomCloudServiceConfiguration(customOrigin)
                    } catch (_: IllegalArgumentException) {
                        null
                    }
                }
            )
        }
    }

    fun updateCustomOrigin(customOrigin: String) {
        draftState.update { state ->
            state.copy(
                customOrigin = customOrigin,
                previewConfiguration = try {
                    if (customOrigin.isBlank()) {
                        null
                    } else {
                        makeCustomCloudServiceConfiguration(customOrigin)
                    }
                } catch (_: IllegalArgumentException) {
                    null
                },
                errorMessage = ""
            )
        }
    }

    suspend fun applyPreviewConfiguration() {
        val previewConfiguration = requireNotNull(draftState.value.previewConfiguration) {
            strings.get(R.string.settings_server_enter_valid_url)
        }
        draftState.update { state -> state.copy(isApplying = true, errorMessage = "") }
        try {
            cloudAccountRepository.applyCustomServer(previewConfiguration)
            draftState.update { state -> state.copy(isApplying = false, errorMessage = "") }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isApplying = false,
                    errorMessage = error.message ?: strings.get(R.string.settings_server_apply_failed)
                )
            }
        }
    }

    suspend fun validateCustomServer() {
        draftState.update { state -> state.copy(isApplying = true, errorMessage = "") }
        try {
            val validatedConfiguration = cloudAccountRepository.validateCustomServer(draftState.value.customOrigin)
            draftState.update { state ->
                state.copy(
                    previewConfiguration = validatedConfiguration,
                    isApplying = false,
                    errorMessage = ""
                )
            }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isApplying = false,
                    errorMessage = error.message ?: strings.get(R.string.settings_server_validate_failed)
                )
            }
        }
    }

    suspend fun resetToOfficialServer() {
        draftState.update { state -> state.copy(isApplying = true, errorMessage = "") }
        try {
            cloudAccountRepository.resetToOfficialServer()
            draftState.update { state ->
                state.copy(
                    customOrigin = "",
                    previewConfiguration = null,
                    isApplying = false,
                    errorMessage = ""
                )
            }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isApplying = false,
                    errorMessage = error.message ?: strings.get(R.string.settings_server_reset_failed)
                )
            }
        }
    }
}

fun createServerSettingsViewModelFactory(
    cloudAccountRepository: CloudAccountRepository,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            ServerSettingsViewModel(
                cloudAccountRepository = cloudAccountRepository,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
