package com.flashcardsopensourceapp.feature.settings.server

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.AppTechnicalErrorController
import com.flashcardsopensourceapp.core.ui.makeAppTechnicalError
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudHealthValidationException
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.cloud.makeCustomCloudServiceConfiguration
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
import kotlinx.coroutines.flow.update
import java.io.IOException

private data class ServerSettingsDraftState(
    val customOrigin: String,
    val previewConfiguration: CloudServiceConfiguration?,
    val isApplying: Boolean,
    val errorMessage: String
)

class ServerSettingsViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val technicalErrorController: AppTechnicalErrorController,
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
        val previewConfiguration = draftState.value.previewConfiguration
        if (previewConfiguration == null) {
            draftState.update { state ->
                state.copy(errorMessage = strings.get(R.string.settings_server_enter_valid_url))
            }
            return
        }
        draftState.update { state -> state.copy(isApplying = true, errorMessage = "") }
        try {
            cloudAccountRepository.applyCustomServer(previewConfiguration)
            draftState.update { state -> state.copy(isApplying = false, errorMessage = "") }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            val errorMessage = strings.get(R.string.settings_server_apply_failed)
            draftState.update { state ->
                state.copy(
                    isApplying = false,
                    errorMessage = errorMessage
                )
            }
            showTechnicalError(
                message = errorMessage,
                throwable = error
            )
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
        } catch (error: IllegalArgumentException) {
            draftState.update { state ->
                state.copy(
                    isApplying = false,
                    errorMessage = strings.get(R.string.settings_server_enter_valid_url)
                )
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: CloudRemoteException) {
            draftState.update { state ->
                state.copy(
                    isApplying = false,
                    errorMessage = strings.get(R.string.settings_server_validate_failed)
                )
            }
        } catch (error: CloudHealthValidationException) {
            draftState.update { state ->
                state.copy(
                    isApplying = false,
                    errorMessage = strings.get(R.string.settings_server_validate_failed)
                )
            }
        } catch (error: IOException) {
            draftState.update { state ->
                state.copy(
                    isApplying = false,
                    errorMessage = strings.get(R.string.settings_server_validate_failed)
                )
            }
        } catch (error: Exception) {
            val errorMessage = strings.get(R.string.settings_server_validate_failed)
            draftState.update { state ->
                state.copy(
                    isApplying = false,
                    errorMessage = errorMessage
                )
            }
            showTechnicalError(
                message = errorMessage,
                throwable = error
            )
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
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            val errorMessage = strings.get(R.string.settings_server_reset_failed)
            draftState.update { state ->
                state.copy(
                    isApplying = false,
                    errorMessage = errorMessage
                )
            }
            showTechnicalError(
                message = errorMessage,
                throwable = error
            )
        }
    }

    private fun showTechnicalError(
        message: String,
        throwable: Throwable
    ) {
        technicalErrorController.showTechnicalError(
            error = makeAppTechnicalError(
                title = strings.get(R.string.settings_technical_error_title),
                message = message,
                throwable = throwable
            ),
            throwable = throwable
        )
    }
}

fun createServerSettingsViewModelFactory(
    cloudAccountRepository: CloudAccountRepository,
    technicalErrorController: AppTechnicalErrorController,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            ServerSettingsViewModel(
                cloudAccountRepository = cloudAccountRepository,
                technicalErrorController = technicalErrorController,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
