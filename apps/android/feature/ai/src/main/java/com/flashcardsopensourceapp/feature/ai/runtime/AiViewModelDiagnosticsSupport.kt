package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.feature.ai.strings.AiTextProvider

internal fun makeAiUserFacingErrorMessage(
    error: Exception,
    surface: AiErrorSurface,
    configuration: CloudServiceConfiguration,
    textProvider: AiTextProvider
): String {
    val remoteError = error as? AiChatRemoteException
    return makeAiChatUserFacingErrorMessage(
        rawMessage = error.message ?: textProvider.requestFailed,
        code = remoteError?.code,
        requestId = remoteError?.requestId,
        configurationMode = configuration.mode,
        surface = surface,
        textProvider = textProvider
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
