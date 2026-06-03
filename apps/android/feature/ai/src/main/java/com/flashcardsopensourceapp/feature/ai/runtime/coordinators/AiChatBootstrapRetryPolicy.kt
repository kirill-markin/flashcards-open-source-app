package com.flashcardsopensourceapp.feature.ai.runtime.coordinators

import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import java.io.IOException
import java.net.ConnectException
import java.net.MalformedURLException
import java.net.NoRouteToHostException
import java.net.ProtocolException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import javax.net.ssl.SSLProtocolException
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
        return shouldRetryHttpStatus(statusCode = remoteError.statusCode)
    }
    val cloudRemoteError = error as? CloudRemoteException ?: findCloudRemoteCause(error = error)
    if (cloudRemoteError != null) {
        return shouldRetryHttpStatus(statusCode = cloudRemoteError.statusCode)
    }
    return error is IOException && isLikelyTransientBootstrapIoException(error = error)
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

private fun isLikelyTransientBootstrapIoException(error: IOException): Boolean {
    if (error is MalformedURLException || error is ProtocolException) {
        return false
    }
    if (
        error is SSLHandshakeException ||
        error is SSLPeerUnverifiedException ||
        error is SSLProtocolException
    ) {
        return false
    }
    if (
        error is SocketTimeoutException ||
        error is ConnectException ||
        error is UnknownHostException ||
        error is NoRouteToHostException ||
        error is SocketException
    ) {
        return true
    }
    if (error is SSLException) {
        return isTransportLikeSslException(error = error)
    }
    return hasTransientTransportMessage(error = error)
}

private fun isTransportLikeSslException(error: SSLException): Boolean {
    if (hasTransientTransportCause(error = error)) {
        return true
    }
    return hasTransientTransportMessage(error = error)
}

private fun hasTransientTransportMessage(error: Throwable): Boolean {
    val message = error.message?.lowercase() ?: return false
    val transportMessageFragments: List<String> = listOf(
        "connection reset",
        "connection closed",
        "connection abort",
        "broken pipe",
        "socket closed",
        "read error",
        "write error",
        "timed out",
        "timeout"
    )
    return transportMessageFragments.any { fragment -> message.contains(fragment) }
}

private fun hasTransientTransportCause(error: Throwable): Boolean {
    var currentCause: Throwable? = error.cause
    while (currentCause != null) {
        if (
            currentCause is SSLHandshakeException ||
            currentCause is SSLPeerUnverifiedException ||
            currentCause is SSLProtocolException
        ) {
            return false
        }
        if (
            currentCause is SocketTimeoutException ||
            currentCause is ConnectException ||
            currentCause is UnknownHostException ||
            currentCause is NoRouteToHostException ||
            currentCause is SocketException
        ) {
            return true
        }
        currentCause = currentCause.cause
    }
    return false
}

private fun shouldRetryHttpStatus(statusCode: Int?): Boolean {
    val resolvedStatusCode = statusCode ?: return false
    return resolvedStatusCode == 408 || resolvedStatusCode == 429 || resolvedStatusCode in 500..599
}
