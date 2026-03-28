package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnection
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

private data class AgentConnectionsDraftState(
    val isLoading: Boolean,
    val instructions: String,
    val errorMessage: String,
    val revokingConnectionId: String?,
    val connections: List<AgentApiKeyConnection>
)

class AgentConnectionsViewModel(
    private val cloudAccountRepository: CloudAccountRepository
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = AgentConnectionsDraftState(
            isLoading = false,
            instructions = "",
            errorMessage = "",
            revokingConnectionId = null,
            connections = emptyList()
        )
    )

    val uiState: StateFlow<AgentConnectionsUiState> = combine(
        cloudAccountRepository.observeCloudSettings(),
        draftState
    ) { cloudSettings, draft ->
        AgentConnectionsUiState(
            isLinked = cloudSettings.cloudState == CloudAccountState.LINKED,
            isLoading = draft.isLoading,
            instructions = draft.instructions,
            errorMessage = draft.errorMessage,
            revokingConnectionId = draft.revokingConnectionId,
            connections = draft.connections.map(::toAgentConnectionItemUiState)
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = AgentConnectionsUiState(
            isLinked = false,
            isLoading = false,
            instructions = "",
            errorMessage = "",
            revokingConnectionId = null,
            connections = emptyList()
        )
    )

    suspend fun loadConnections() {
        if (uiState.value.isLinked.not()) {
            draftState.update { state ->
                state.copy(
                    isLoading = false,
                    instructions = "",
                    errorMessage = "",
                    revokingConnectionId = null,
                    connections = emptyList()
                )
            }
            return
        }

        draftState.update { state ->
            state.copy(isLoading = true, errorMessage = "")
        }

        try {
            val result = cloudAccountRepository.listAgentConnections()
            draftState.update { state ->
                state.copy(
                    isLoading = false,
                    instructions = result.instructions,
                    errorMessage = "",
                    connections = result.connections
                )
            }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isLoading = false,
                    errorMessage = error.message ?: "Could not load agent connections."
                )
            }
        }
    }

    suspend fun revokeConnection(connectionId: String) {
        draftState.update { state ->
            state.copy(
                revokingConnectionId = connectionId,
                errorMessage = ""
            )
        }

        try {
            val result = cloudAccountRepository.revokeAgentConnection(connectionId = connectionId)
            val revokedConnection = result.connections.single()
            draftState.update { state ->
                state.copy(
                    instructions = result.instructions,
                    errorMessage = "",
                    revokingConnectionId = null,
                    connections = state.connections.map { connection ->
                        if (connection.connectionId == revokedConnection.connectionId) {
                            revokedConnection
                        } else {
                            connection
                        }
                    }
                )
            }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    errorMessage = error.message ?: "Could not revoke the agent connection.",
                    revokingConnectionId = null
                )
            }
        }
    }
}

fun createAgentConnectionsViewModelFactory(cloudAccountRepository: CloudAccountRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AgentConnectionsViewModel(cloudAccountRepository = cloudAccountRepository)
        }
    }
}

private fun toAgentConnectionItemUiState(connection: AgentApiKeyConnection): AgentConnectionItemUiState {
    return AgentConnectionItemUiState(
        connectionId = connection.connectionId,
        label = connection.label,
        createdAtLabel = formatTimestampLabel(timestampMillis = connection.createdAtMillis),
        lastUsedAtLabel = formatTimestampLabel(timestampMillis = connection.lastUsedAtMillis),
        revokedAtLabel = formatTimestampLabel(timestampMillis = connection.revokedAtMillis),
        isRevoked = connection.revokedAtMillis != null
    )
}
