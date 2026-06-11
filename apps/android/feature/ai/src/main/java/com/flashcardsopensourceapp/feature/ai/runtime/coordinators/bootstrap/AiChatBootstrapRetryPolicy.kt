package com.flashcardsopensourceapp.feature.ai.runtime.coordinators.bootstrap

import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.network.isLikelyTransientNetworkIoException
import com.flashcardsopensourceapp.data.local.network.isRetryableHttpStatusCode
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlin.random.Random

private const val aiBootstrapMaxRetryCount: Int = 2
private const val aiBootstrapFirstRetryDelayMillis: Long = 300L
private const val aiBootstrapSecondRetryDelayMillis: Long = 900L
private const val aiBootstrapRetryJitterUpperBoundMillis: Long = 151L

internal fun shouldRetryBootstrap(error: Exception, retryCount: Int): Boolean {
    if (retryCount >= aiBootstrapMaxRetryCount) {
        return false
    }
    return isRetryableBootstrapFailure(error = error)
}

internal fun isRetryableBootstrapFailure(error: Exception): Boolean {
    if (error is CancellationException) {
        return false
    }
    val remoteError = error as? AiChatRemoteException
    if (remoteError != null) {
        return isRetryableHttpStatusCode(statusCode = remoteError.statusCode)
    }
    val cloudRemoteError = error as? CloudRemoteException ?: findCloudRemoteCause(error = error)
    if (cloudRemoteError != null) {
        return isRetryableHttpStatusCode(statusCode = cloudRemoteError.statusCode)
    }
    return error is IOException && isLikelyTransientNetworkIoException(error = error)
}

internal fun nextBootstrapRetryDelayMillis(retryCount: Int): Long {
    val baseDelayMillis = if (retryCount == 0) {
        aiBootstrapFirstRetryDelayMillis
    } else {
        aiBootstrapSecondRetryDelayMillis
    }
    return baseDelayMillis + Random.nextLong(
        from = 0L,
        until = aiBootstrapRetryJitterUpperBoundMillis
    )
}

private fun findCloudRemoteCause(error: Throwable): CloudRemoteException? {
    var currentCause: Throwable? = error.cause
    while (currentCause != null) {
        if (currentCause is CloudRemoteException) {
            return currentCause
        }
        currentCause = currentCause.cause
    }
    return null
}
