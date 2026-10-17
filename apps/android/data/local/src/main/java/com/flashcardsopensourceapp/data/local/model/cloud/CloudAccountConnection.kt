package com.flashcardsopensourceapp.data.local.model.cloud

import kotlinx.serialization.Serializable

@Serializable
data class CloudConnectionSuggestion(val suggestion: String, val expiresAtMillis: Long)

@Serializable
data class CloudConnectionWorkspace(val id: String, val name: String, val creationOrigin: String,
    val unusedStarter: Boolean, val suppressed: Boolean)

@Serializable
data class CloudConnectionBaseline(val workspace: String, val cards: String)

@Serializable
data class CloudConnectionPreview(val operationId: String, val digest: String, val omittedWorkspaceIds: List<String>,
    val historicalBaselines: Map<String, CloudConnectionBaseline>, val workspaces: List<CloudConnectionWorkspace>,
    val workspaceIds: List<String>, val suppressedWorkspaceIds: List<String>, val selectedWorkspaceId: String,
    val omissionCandidateWorkspaceIds: List<String>)

@Serializable
data class CloudConnectionCommit(val operationId: String, val sourceUserId: String, val canonicalAccountId: String,
    val selectedWorkspaceId: String, val workspaceIds: List<String>, val suppressedWorkspaceIds: List<String>)

@Serializable
data class CloudAccountConnection(val operation: String?, val expiresAtMillis: Long, val proved: Boolean,
    val preview: CloudConnectionPreview?, val committed: CloudConnectionCommit?, val suggestion: CloudConnectionSuggestion?)

sealed interface CloudConnectionAction {
    data class Begin(val completion: String) : CloudConnectionAction
    data class Adopt(val suggestion: String) : CloudConnectionAction
    data class Load(val operation: String) : CloudConnectionAction
    data class Cancel(val operation: String) : CloudConnectionAction
    data class ProviderBegin(val operation: String, val provider: CloudSocialProvider, val challenge: String) : CloudConnectionAction
    data class GoogleComplete(val operation: String, val attempt: String, val identityToken: String) : CloudConnectionAction
    data class EmailSend(val operation: String, val email: String) : CloudConnectionAction
    data class EmailVerify(val operation: String, val code: String) : CloudConnectionAction
    data class Preview(val operation: String, val omittedWorkspaceIds: List<String>) : CloudConnectionAction
    data class Confirm(val operation: String, val preview: CloudConnectionPreview) : CloudConnectionAction
}

sealed interface CloudConnectionResponse {
    data class Receipt(val operation: String, val expiresAtMillis: Long, val proved: Boolean) : CloudConnectionResponse
    data class Provider(val proof: CloudAccountMethodAttempt) : CloudConnectionResponse
    data class Email(val email: String, val expiresAtMillis: Long) : CloudConnectionResponse
    data class Preview(val operation: String, val choices: CloudConnectionPreview) : CloudConnectionResponse
    data class Connected(val result: CloudConnectionCommit) : CloudConnectionResponse
    data class AlreadyConnected(val operation: String) : CloudConnectionResponse
    data class Cancelled(val operation: String) : CloudConnectionResponse
}


class CloudConnectionWorkspaceUnavailableException(val selectedWorkspaceId: String) :
    IllegalStateException("The current offline workspace is unavailable after account connection.")
