package com.flashcardsopensourceapp.feature.ai.runtime.coordinators

import com.flashcardsopensourceapp.data.local.ai.diagnostics.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.ai.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatSessionProvisioningResult
import com.flashcardsopensourceapp.data.local.model.ai.AiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.repository.AiChatPreparedRemoteSession
import com.flashcardsopensourceapp.feature.ai.runtime.AiChatRuntimeContext
import com.flashcardsopensourceapp.feature.ai.runtime.observability.remoteErrorFields
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

internal suspend fun resolveRemoteBootstrapSession(
    context: AiChatRuntimeContext,
    preparedSession: AiChatPreparedRemoteSession,
    persistedState: AiChatPersistedState,
    bootstrapProvisionalSessionId: String?,
    onInitialProvisioningAttempted: () -> Unit,
    onInitialProvisioningCompleted: () -> Unit,
    onRemoteSessionProvisioned: (String) -> Unit
): AiChatSessionProvisioningResult {
    val normalizedSessionId = persistedState.chatSessionId.trim().ifEmpty { null }
    if (normalizedSessionId != null && persistedState.requiresRemoteSessionProvisioning.not()) {
        return AiChatSessionProvisioningResult(
            sessionId = normalizedSessionId,
            snapshot = null
        )
    }

    val targetSessionId = normalizedSessionId ?: requireNotNull(bootstrapProvisionalSessionId) {
        "AI bootstrap requires a provisional session id when persisted session id is blank."
    }
    if (normalizedSessionId == null) {
        onInitialProvisioningAttempted()
    }
    val snapshot = createNewAiChatSessionFromPreparedSessionOnce(
        context = context,
        preparedSession = preparedSession,
        targetSessionId = targetSessionId
    )
    onRemoteSessionProvisioned(targetSessionId)
    if (normalizedSessionId == null) {
        onInitialProvisioningCompleted()
    }
    return AiChatSessionProvisioningResult(
        sessionId = targetSessionId,
        snapshot = snapshot
    )
}

internal suspend fun createNewAiChatSessionWithBootstrapRetry(
    context: AiChatRuntimeContext,
    workspaceId: String?,
    targetSessionId: String,
    retryEvent: String
): AiChatSessionSnapshot {
    var retryCount: Int = 0
    while (true) {
        try {
            val preparedSession = context.aiChatRepository.prepareSessionForAi(workspaceId = workspaceId)
            return createNewAiChatSessionFromPreparedSessionOnce(
                context = context,
                preparedSession = preparedSession,
                targetSessionId = targetSessionId
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (shouldRetryBootstrap(error = error, retryCount = retryCount).not()) {
                throw error
            }
            logAiChatSessionProvisioningRetry(
                context = context,
                workspaceId = workspaceId,
                targetSessionId = targetSessionId,
                retryCount = retryCount,
                retryEvent = retryEvent,
                error = error
            )
            delay(timeMillis = nextBootstrapRetryDelayMillis(retryCount = retryCount))
            retryCount += 1
        }
    }
}

internal suspend fun createNewAiChatSessionOnce(
    context: AiChatRuntimeContext,
    workspaceId: String?,
    targetSessionId: String
): AiChatSessionSnapshot {
    val snapshot = context.aiChatRepository.createNewSession(
        workspaceId = workspaceId,
        sessionId = targetSessionId,
        uiLocale = context.currentUiLocaleTag()
    )
    if (snapshot.sessionId != targetSessionId) {
        throw IllegalStateException(
            "AI chat session provisioning returned mismatched sessionId. " +
                "expected=$targetSessionId actual=${snapshot.sessionId}"
        )
    }
    return snapshot
}

private suspend fun createNewAiChatSessionFromPreparedSessionOnce(
    context: AiChatRuntimeContext,
    preparedSession: AiChatPreparedRemoteSession,
    targetSessionId: String
): AiChatSessionSnapshot {
    val snapshot = context.aiChatRepository.createNewSessionFromPreparedSession(
        preparedSession = preparedSession,
        sessionId = targetSessionId,
        uiLocale = context.currentUiLocaleTag()
    )
    if (snapshot.sessionId != targetSessionId) {
        throw IllegalStateException(
            "AI chat session provisioning returned mismatched sessionId. " +
                "expected=$targetSessionId actual=${snapshot.sessionId}"
        )
    }
    return snapshot
}

private fun logAiChatSessionProvisioningRetry(
    context: AiChatRuntimeContext,
    workspaceId: String?,
    targetSessionId: String,
    retryCount: Int,
    retryEvent: String,
    error: Exception
) {
    val retryFields: List<Pair<String, String?>> = listOf(
        "workspaceId" to workspaceId,
        "cloudState" to context.currentCloudState().name,
        "chatSessionId" to targetSessionId,
        "nextAttempt" to (retryCount + 2).toString(),
        "errorType" to error::class.java.name
    )
    AiChatDiagnosticsLogger.warn(
        event = retryEvent,
        fields = retryFields + remoteErrorFields(error = error as? AiChatRemoteException)
    )
}
