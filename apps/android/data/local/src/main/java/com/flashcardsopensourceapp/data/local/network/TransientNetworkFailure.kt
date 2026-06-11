package com.flashcardsopensourceapp.data.local.network

import java.io.IOException
import java.net.ConnectException
import java.net.MalformedURLException
import java.net.NoRouteToHostException
import java.net.ProtocolException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertPathValidatorException
import java.security.cert.CertificateException
import javax.net.ssl.SSLException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import javax.net.ssl.SSLProtocolException

fun isLikelyTransientNetworkIoException(error: IOException): Boolean {
    if (error is MalformedURLException || error is ProtocolException) {
        return false
    }
    if (error is SSLPeerUnverifiedException || error is SSLProtocolException) {
        return false
    }
    if (error is SSLHandshakeException) {
        return isTransientSslHandshakeException(error = error)
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

fun isRetryableHttpStatusCode(statusCode: Int?): Boolean {
    val resolvedStatusCode: Int = statusCode ?: return false
    return resolvedStatusCode == 408 || resolvedStatusCode == 429 || resolvedStatusCode in 500..599
}

private fun isTransientSslHandshakeException(error: SSLHandshakeException): Boolean {
    if (hasNonRetryableTlsCause(error = error)) {
        return false
    }
    if (hasTransientTransportCause(error = error)) {
        return true
    }
    return hasTransientTransportMessage(error = error)
}

private fun isTransportLikeSslException(error: SSLException): Boolean {
    if (hasNonRetryableTlsCause(error = error)) {
        return false
    }
    if (hasTransientTransportCause(error = error)) {
        return true
    }
    return hasTransientTransportMessage(error = error)
}

private fun hasTransientTransportMessage(error: Throwable): Boolean {
    val message: String = error.message?.lowercase() ?: return false
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

private fun hasNonRetryableTlsCause(error: Throwable): Boolean {
    var currentCause: Throwable? = error.cause
    while (currentCause != null) {
        if (
            currentCause is SSLPeerUnverifiedException ||
            currentCause is SSLProtocolException ||
            currentCause is CertPathValidatorException ||
            currentCause is CertificateException
        ) {
            return true
        }
        currentCause = currentCause.cause
    }
    return false
}

private fun hasTransientTransportCause(error: Throwable): Boolean {
    var currentCause: Throwable? = error.cause
    while (currentCause != null) {
        if (
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
