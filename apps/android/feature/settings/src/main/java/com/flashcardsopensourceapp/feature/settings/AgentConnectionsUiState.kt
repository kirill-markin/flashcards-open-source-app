package com.flashcardsopensourceapp.feature.settings

data class AgentConnectionsUiState(
    val isLinked: Boolean,
    val isLoading: Boolean,
    val instructions: String,
    val errorMessage: String,
    val revokingConnectionId: String?,
    val connections: List<AgentConnectionItemUiState>
)

data class AgentConnectionItemUiState(
    val connectionId: String,
    val label: String,
    val createdAtLabel: String,
    val lastUsedAtLabel: String,
    val revokedAtLabel: String,
    val isRevoked: Boolean
)
