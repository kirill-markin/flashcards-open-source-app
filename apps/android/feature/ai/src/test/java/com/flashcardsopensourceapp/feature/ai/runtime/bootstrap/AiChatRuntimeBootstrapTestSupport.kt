package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException

internal fun makeCloudContractMismatchException(message: String): Exception {
    val errorClass = Class.forName(
        "com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException"
    )
    val constructor = errorClass.getDeclaredConstructor(String::class.java, Throwable::class.java)
    constructor.isAccessible = true
    return constructor.newInstance(message, null) as Exception
}

internal fun makeCloudRemoteException(statusCode: Int): CloudRemoteException {
    return CloudRemoteException(
        message = "Cloud request failed with status $statusCode.",
        statusCode = statusCode,
        responseBody = """{"message":"temporary"}""",
        errorCode = null,
        requestId = "request-$statusCode",
        syncConflict = null
    )
}
