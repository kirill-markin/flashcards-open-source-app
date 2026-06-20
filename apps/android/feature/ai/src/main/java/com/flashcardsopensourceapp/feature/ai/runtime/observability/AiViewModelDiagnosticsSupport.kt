package com.flashcardsopensourceapp.feature.ai.runtime.observability

import com.flashcardsopensourceapp.core.observability.alreadyObservedAndroidThrowable
import com.flashcardsopensourceapp.core.observability.shouldCaptureAndroidThrowable
import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.ai.remote.isExpectedAiChatRemoteUserError
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.feature.ai.AiBootstrapErrorPresentation
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiAlertState
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.bootstrap.AiChatBootstrapBlockedException
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiErrorSurface
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiUserFacingErrorPresentation
import com.flashcardsopensourceapp.feature.ai.runtime.errors.aiChatAvailabilityMessage
import com.flashcardsopensourceapp.feature.ai.runtime.errors.makeAiChatUserFacingErrorPresentation
import com.flashcardsopensourceapp.feature.ai.strings.AiTextProvider
import java.io.IOException

private const val cloudContractMismatchExceptionName: String =
    "com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException"
private const val aiChatBootstrapSessionMismatchExceptionName: String =
    "com.flashcardsopensourceapp.feature.ai.runtime.coordinators.bootstrap.AiChatBootstrapSessionMismatchException"

internal fun makeAiUserFacingErrorPresentation(
    error: Exception,
    surface: AiErrorSurface,
    configuration: CloudServiceConfiguration,
    textProvider: AiTextProvider
): AiUserFacingErrorPresentation {
    val remoteError = error as? AiChatRemoteException
    val presentation = makeAiChatUserFacingErrorPresentation(
        throwable = error,
        code = remoteError?.code,
        requestId = remoteError?.requestId,
        configurationMode = configuration.mode,
        surface = surface,
        textProvider = textProvider
    )
    if (shouldSuppressExpectedAiTechnicalPresentation(error = error, remoteError = remoteError)) {
        return presentation.copy(technicalError = null)
    }
    return presentation
}

internal fun makeAiErrorAlert(
    presentation: AiUserFacingErrorPresentation,
    technicalErrorAlreadyObserved: Boolean,
    textProvider: AiTextProvider
): AiAlertState {
    val technicalError = presentation.technicalError ?: return textProvider.generalError(
        message = presentation.message
    )
    val throwable = if (
        technicalErrorAlreadyObserved &&
        shouldCaptureAndroidThrowable(throwable = technicalError)
    ) {
        alreadyObservedAndroidThrowable(throwable = technicalError)
    } else {
        technicalError
    }
    return textProvider.technicalError(
        message = presentation.message,
        throwable = throwable
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
        technicalDetails = if (
            shouldSuppressExpectedAiTechnicalPresentation(
                error = error,
                remoteError = remoteError
            )
        ) {
            null
        } else {
            errorTechnicalDetails(error = error)
        }
    )
}

private fun shouldSuppressExpectedAiTechnicalPresentation(
    error: Exception,
    remoteError: AiChatRemoteException?
): Boolean {
    if (remoteError != null && isExpectedAiChatRemoteUserError(error = remoteError)) {
        return true
    }
    if (error is AiChatBootstrapBlockedException) {
        return true
    }
    if (error is IOException) {
        return aiChatFailureIssueDisposition(error = error) == AiChatFailureIssueDisposition.NONE
    }
    return false
}

internal fun remoteErrorFields(error: AiChatRemoteException?): List<Pair<String, String?>> {
    return listOf(
        "requestId" to error?.requestId,
        "statusCode" to error?.statusCode?.toString(),
        "code" to error?.code,
        "stage" to error?.stage
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

    return error is IOException ||
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
