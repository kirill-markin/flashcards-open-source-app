package com.flashcardsopensourceapp.feature.settings.ai

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.ai.OwnOpenAiKeySettings
import com.flashcardsopensourceapp.data.local.model.ai.OwnOpenAiKeyStorageStatus
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

private data class OwnOpenAiKeyUsageState(
    val ownKeyMessages: Int?,
    val errorMessage: String
)

class OwnOpenAiKeyViewModel(
    private val aiChatRepository: AiChatRepository,
    private val cloudAccountRepository: CloudAccountRepository,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val usageState = MutableStateFlow(
        value = OwnOpenAiKeyUsageState(
            ownKeyMessages = null,
            errorMessage = ""
        )
    )

    val uiState: StateFlow<OwnOpenAiKeyUiState> = combine(
        aiChatRepository.observeOwnOpenAiKeySettings(),
        usageState
    ) { settings, usage ->
        makeOwnOpenAiKeyUiState(settings = settings, usage = usage)
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = makeOwnOpenAiKeyUiState(
            settings = aiChatRepository.currentOwnOpenAiKeySettings(),
            usage = usageState.value
        )
    )

    init {
        viewModelScope.launch {
            cloudAccountRepository.observeCloudSettings()
                .distinctUntilChangedBy { cloudSettings -> cloudSettings.cloudState }
                .collect { cloudSettings ->
                    loadOwnKeyMessages(cloudSettings = cloudSettings)
                }
        }
    }

    fun updateEnabled(isEnabled: Boolean) {
        aiChatRepository.updateOwnOpenAiKeyEnabled(isEnabled = isEnabled)
    }

    fun updateApiKey(apiKey: String) {
        aiChatRepository.updateOwnOpenAiKey(apiKey = apiKey)
    }

    /**
     * Only an install that already has a cloud session can read its usage, so opening this screen
     * never creates one.
     */
    private suspend fun loadOwnKeyMessages(cloudSettings: CloudSettings) {
        if (canReadAiUsage(cloudState = cloudSettings.cloudState).not()) {
            usageState.value = OwnOpenAiKeyUsageState(
                ownKeyMessages = null,
                errorMessage = ""
            )
            return
        }
        try {
            val usage = aiChatRepository.loadAiUsage(workspaceId = cloudSettings.activeWorkspaceId)
            usageState.value = OwnOpenAiKeyUsageState(
                ownKeyMessages = usage.ownKeyMessages,
                errorMessage = ""
            )
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            usageState.value = OwnOpenAiKeyUsageState(
                ownKeyMessages = null,
                errorMessage = strings.get(R.string.settings_own_openai_key_usage_load_failed)
            )
        }
    }
}

private fun makeOwnOpenAiKeyUiState(
    settings: OwnOpenAiKeySettings,
    usage: OwnOpenAiKeyUsageState
): OwnOpenAiKeyUiState {
    return OwnOpenAiKeyUiState(
        isEnabled = settings.isEnabled,
        apiKey = settings.apiKey,
        isApiKeyFieldEnabled = settings.storageStatus != OwnOpenAiKeyStorageStatus.NOT_LOADED,
        isStoredKeyUnreadable = settings.storageStatus == OwnOpenAiKeyStorageStatus.UNREADABLE,
        ownKeyMessages = usage.ownKeyMessages,
        usageErrorMessage = usage.errorMessage
    )
}

private fun canReadAiUsage(cloudState: CloudAccountState): Boolean {
    return cloudState == CloudAccountState.GUEST || cloudState == CloudAccountState.LINKED
}

fun createOwnOpenAiKeyViewModelFactory(
    aiChatRepository: AiChatRepository,
    cloudAccountRepository: CloudAccountRepository,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            OwnOpenAiKeyViewModel(
                aiChatRepository = aiChatRepository,
                cloudAccountRepository = cloudAccountRepository,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
