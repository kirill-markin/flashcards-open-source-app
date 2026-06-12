package com.flashcardsopensourceapp.feature.settings.leaderboard

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCommunityProfile
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private data class LeaderboardParticipationDraftState(
    val errorMessage: String,
    val isUpdating: Boolean
)

class LeaderboardParticipationViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val communityProfileState = MutableStateFlow<CloudCommunityProfile?>(value = null)
    private val draftState = MutableStateFlow(
        value = LeaderboardParticipationDraftState(
            errorMessage = "",
            isUpdating = false
        )
    )

    val uiState: StateFlow<LeaderboardParticipationUiState> = combine(
        cloudAccountRepository.observeCloudSettings(),
        communityProfileState,
        draftState
    ) { cloudSettings, communityProfile, draft ->
        val canManageLeaderboardParticipation = canManageLeaderboardParticipation(
            cloudState = cloudSettings.cloudState
        )
        LeaderboardParticipationUiState(
            canManageLeaderboardParticipation = canManageLeaderboardParticipation,
            leaderboardParticipationEnabled = if (canManageLeaderboardParticipation) {
                communityProfile?.leaderboardParticipationEnabled
            } else {
                null
            },
            errorMessage = draft.errorMessage,
            isUpdating = draft.isUpdating
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = LeaderboardParticipationUiState(
            canManageLeaderboardParticipation = false,
            leaderboardParticipationEnabled = null,
            errorMessage = "",
            isUpdating = false
        )
    )

    init {
        viewModelScope.launch {
            cloudAccountRepository.observeCloudSettings()
                .map { cloudSettings -> cloudSettings.cloudState }
                .distinctUntilChanged()
                .collect { cloudState ->
                    if (canManageLeaderboardParticipation(cloudState = cloudState)) {
                        loadCommunityProfile()
                    } else {
                        communityProfileState.value = null
                        draftState.update { state -> state.copy(errorMessage = "") }
                    }
                }
        }
    }

    fun updateLeaderboardParticipation(leaderboardParticipationEnabled: Boolean) {
        viewModelScope.launch {
            draftState.update { state ->
                state.copy(
                    errorMessage = "",
                    isUpdating = true
                )
            }
            try {
                communityProfileState.value = cloudAccountRepository.updateCommunityLeaderboardParticipation(
                    leaderboardParticipationEnabled = leaderboardParticipationEnabled
                )
                draftState.update { state ->
                    state.copy(
                        errorMessage = "",
                        isUpdating = false
                    )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                draftState.update { state ->
                    state.copy(
                        errorMessage = error.message
                            ?: strings.get(R.string.settings_leaderboard_participation_update_failed),
                        isUpdating = false
                    )
                }
            }
        }
    }

    private suspend fun loadCommunityProfile() {
        try {
            communityProfileState.value = cloudAccountRepository.loadCommunityProfile()
            draftState.update { state -> state.copy(errorMessage = "") }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            communityProfileState.value = null
            draftState.update { state ->
                state.copy(
                    errorMessage = error.message
                        ?: strings.get(R.string.settings_leaderboard_participation_load_failed)
                )
            }
        }
    }
}

private fun canManageLeaderboardParticipation(cloudState: CloudAccountState): Boolean {
    return cloudState == CloudAccountState.GUEST || cloudState == CloudAccountState.LINKED
}

fun createLeaderboardParticipationViewModelFactory(
    cloudAccountRepository: CloudAccountRepository,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            LeaderboardParticipationViewModel(
                cloudAccountRepository = cloudAccountRepository,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
