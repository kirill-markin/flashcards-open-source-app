package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.feature.ai.AiBootstrapErrorPresentation
import com.flashcardsopensourceapp.feature.ai.strings.AiTextProvider
import java.io.IOException

private const val cloudContractMismatchExceptionName: String =
    "com.flashcardsopensourceapp.data.local.cloud.CloudContractMismatchException"
private const val aiChatBootstrapSessionMismatchExceptionName: String =
    "com.flashcardsopensourceapp.feature.ai.runtime.AiChatBootstrapSessionMismatchException"

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

internal fun makeAiBootstrapErrorPresentation(
    error: Exception,
    configuration: CloudServiceConfiguration,
    textProvider: AiTextProvider
): AiBootstrapErrorPresentation {
    val remoteError = error as? AiChatRemoteException
    val message = when {
        error is AiChatBootstrapBlockedException -> textProvider.bootstrapAccountStatusErrorMessage
        error is IOException -> textProvider.bootstrapNetworkErrorMessage
        remoteError != null -> remoteErrorPrimaryMessage(
            error = remoteError,
            configuration = configuration,
            textProvider = textProvider
        )
        else -> textProvider.bootstrapGenericErrorMessage
    }

    return AiBootstrapErrorPresentation(
        message = message,
        technicalDetails = errorTechnicalDetails(error = error)
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

private fun remoteErrorPrimaryMessage(
    error: AiChatRemoteException,
    configuration: CloudServiceConfiguration,
    textProvider: AiTextProvider
): String {
    val mappedMessage = error.code?.let { code ->
        aiChatAvailabilityMessage(
            code = code,
            configurationMode = configuration.mode,
            surface = AiErrorSurface.CHAT,
            textProvider = textProvider
        )
    }
    return mappedMessage ?: textProvider.bootstrapGenericErrorMessage
}

private fun errorTechnicalDetails(error: Exception): String {
    val remoteError = error as? AiChatRemoteException
    if (remoteError != null) {
        return formatTechnicalDetails(
            fields = listOf(
                "type" to error::class.java.name,
                "statusCode" to remoteError.statusCode?.toString(),
                "code" to remoteError.code,
                "stage" to remoteError.stage,
                "requestId" to remoteError.requestId
            )
        )
    }

    val localFields = if (shouldIncludeLocalErrorMessage(error = error)) {
        listOf(
            "type" to error::class.java.name,
            "message" to error.message
        )
    } else {
        listOf("type" to error::class.java.name)
    }
    return formatTechnicalDetails(fields = localFields)
}

private fun shouldIncludeLocalErrorMessage(error: Exception): Boolean {
    val message = error.message
    if (message.isNullOrBlank()) {
        return false
    }
    if (error::class.java.name == cloudContractMismatchExceptionName) {
        return false
    }

    return error is AiChatBootstrapBlockedException ||
        error is IOException ||
        error::class.java.name == aiChatBootstrapSessionMismatchExceptionName
}

private fun formatTechnicalDetails(fields: List<Pair<String, String?>>): String {
    return fields.mapNotNull { field ->
        val value = field.second
        if (value.isNullOrBlank()) {
            null
        } else {
            "${field.first}: $value"
        }
    }.joinToString(separator = "\n")
}
