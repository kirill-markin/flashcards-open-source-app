package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration

internal fun makeAiUserFacingErrorMessage(
    error: Exception,
    surface: AiErrorSurface,
    configuration: CloudServiceConfiguration
): String {
    val remoteError = error as? AiChatRemoteException
    return makeAiChatUserFacingErrorMessage(
        rawMessage = error.message ?: "AI request failed.",
        code = remoteError?.code,
        requestId = remoteError?.requestId,
        configurationMode = configuration.mode,
        surface = surface
    )
}

internal fun remoteErrorFields(error: AiChatRemoteException?): List<Pair<String, String?>> {
    return listOf(
        "requestId" to error?.requestId,
        "statusCode" to error?.statusCode?.toString(),
        "code" to error?.code,
        "stage" to error?.stage,
        "responseBody" to error?.responseBody
    )
}
