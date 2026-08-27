package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException

internal fun makeCloudContractMismatchException(message: String): CloudContractMismatchException {
    return CloudContractMismatchException(message = message, cause = null)
}

internal fun makeCloudRemoteException(statusCode: Int): CloudRemoteException {
    return CloudRemoteException(
        message = "Cloud request failed with status $statusCode.",
        statusCode = statusCode,
        responseBody = """{"message":"temporary"}""",
        errorCode = null,
        requestId = "request-$statusCode",
        syncConflict = null,
        androidObservationAlreadyCaptured = false
    )
}
