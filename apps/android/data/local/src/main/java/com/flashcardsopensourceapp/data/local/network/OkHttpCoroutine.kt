package com.flashcardsopensourceapp.data.local.network

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resumeWithException

internal suspend fun Call.awaitOkHttpResponse(): Response {
    return suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation {
            cancel()
        }
        enqueue(object : Callback {
            override fun onFailure(call: Call, error: IOException) {
                if (continuation.isActive) {
                    continuation.resumeWithException(error)
                }
            }

            override fun onResponse(call: Call, response: Response) {
                if (continuation.isActive.not()) {
                    response.close()
                    return
                }
                continuation.resume(response) { _, responseToClose, _ ->
                    responseToClose.close()
                }
            }
        })
    }
}
