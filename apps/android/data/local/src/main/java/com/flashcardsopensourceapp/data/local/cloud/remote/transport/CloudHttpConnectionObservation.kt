package com.flashcardsopensourceapp.data.local.cloud.remote.transport

import okhttp3.Call
import okhttp3.Connection
import okhttp3.EventListener
import okhttp3.Request

internal data class CloudHttpConnectionSnapshot(
    val connectionId: String?,
    val connectionProtocol: String?,
    val requestHeadersCompleted: Boolean
)

internal class CloudHttpConnectionObservation : EventListener() {
    private var state = CloudHttpConnectionSnapshot(
        connectionId = null,
        connectionProtocol = null,
        requestHeadersCompleted = false
    )

    @Synchronized
    override fun connectionAcquired(call: Call, connection: Connection) {
        state = state.copy(
            connectionId = System.identityHashCode(connection).toString(),
            connectionProtocol = connection.protocol().toString()
        )
    }

    @Synchronized
    override fun requestHeadersEnd(call: Call, request: Request) {
        state = state.copy(requestHeadersCompleted = true)
    }

    @Synchronized
    fun snapshot(): CloudHttpConnectionSnapshot = state
}
