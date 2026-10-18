package com.flashcardsopensourceapp.app.diagnostics

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.app.FirebaseAppInstrumentationTimeoutTest
import com.flashcardsopensourceapp.app.ManualOnlyAndroidTest
import com.flashcardsopensourceapp.data.local.model.cloud.makeOfficialCloudServiceConfiguration
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.Connection
import okhttp3.EventListener
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
@ManualOnlyAndroidTest
class HttpProtocolProbeTest : FirebaseAppInstrumentationTimeoutTest() {
    @Test
    fun http2PreferredPublicEndpointsComplete() {
        runProtocolProbe(
            caseName = "h2_preferred",
            protocols = listOf(Protocol.HTTP_2, Protocol.HTTP_1_1),
            expectedProtocol = Protocol.HTTP_2
        )
    }

    @Test
    fun http11OnlyPublicEndpointsComplete() {
        runProtocolProbe(
            caseName = "http11_only",
            protocols = listOf(Protocol.HTTP_1_1),
            expectedProtocol = Protocol.HTTP_1_1
        )
    }

    private fun runProtocolProbe(caseName: String, protocols: List<Protocol>, expectedProtocol: Protocol) {
        val configuration = makeOfficialCloudServiceConfiguration()
        val endpoints = listOf(
            ProtocolProbeEndpoint("auth", configuration.authBaseUrl, "/api/auth-methods"),
            ProtocolProbeEndpoint("api", configuration.apiBaseUrl, "/agent")
        )
        val client = OkHttpClient.Builder()
            .protocols(protocols)
            .connectTimeout(15L, TimeUnit.SECONDS)
            .readTimeout(30L, TimeUnit.SECONDS)
            .writeTimeout(120L, TimeUnit.SECONDS)
            .eventListenerFactory { call ->
                requireNotNull(call.request().tag(ProtocolProbeObservation::class.java))
            }
            .build()
        val failures: MutableList<Throwable> = mutableListOf()
        try {
            for (endpoint in endpoints) {
                for (requestIndex in 1..6) {
                    val observation = ProtocolProbeObservation()
                    val request = Request.Builder()
                        .url(endpoint.baseUrl + endpoint.path)
                        .get()
                        .tag(ProtocolProbeObservation::class.java, observation)
                        .build()
                    var statusCode: Int? = null
                    var actualProtocol: Protocol? = null
                    var bodyRead: Boolean = false
                    var exceptionClass: String? = null
                    val startedAtNanos: Long = System.nanoTime()
                    try {
                        client.newCall(request).execute().use { response ->
                            statusCode = response.code
                            actualProtocol = response.protocol
                            response.body.bytes()
                            bodyRead = true
                            if (statusCode != 200 || actualProtocol != expectedProtocol) {
                                val failure = AssertionError(
                                    "$caseName ${endpoint.origin}${endpoint.path} request $requestIndex: " +
                                        "expected status 200 and $expectedProtocol, got $statusCode and $actualProtocol."
                                )
                                exceptionClass = failure::class.java.name
                                failures.add(failure)
                            }
                        }
                    } catch (error: IOException) {
                        exceptionClass = error::class.java.name
                        failures.add(error)
                    } catch (error: Exception) {
                        exceptionClass = error::class.java.name
                        throw error
                    } finally {
                        val snapshot = observation.snapshot()
                        Log.i(
                            "HttpProtocolProbe",
                            "event=http_protocol_probe case=$caseName origin=${endpoint.origin} path=${endpoint.path} " +
                                "requestIndex=$requestIndex elapsedMs=${TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAtNanos)} " +
                                "protocol=$actualProtocol statusCode=$statusCode bodyRead=$bodyRead exceptionClass=$exceptionClass " +
                                "phase=${snapshot.phase} connectionId=${snapshot.connectionId} connectionProtocol=${snapshot.connectionProtocol}"
                        )
                    }
                }
            }
        } finally {
            client.dispatcher.executorService.shutdown()
            client.connectionPool.evictAll()
        }
        if (failures.isNotEmpty()) {
            val failure = AssertionError(
                "$caseName HTTP protocol probe failed ${failures.size} of 12 requests; inspect http_protocol_probe completion records."
            )
            failures.forEach { cause -> failure.addSuppressed(cause) }
            throw failure
        }
    }
}

private data class ProtocolProbeEndpoint(val origin: String, val baseUrl: String, val path: String)

private data class ProtocolProbeSnapshot(
    val phase: String,
    val connectionId: String?,
    val connectionProtocol: String?
)

private class ProtocolProbeObservation : EventListener() {
    private var state = ProtocolProbeSnapshot("call_created", null, null)

    @Synchronized
    override fun dnsStart(call: Call, domainName: String) {
        state = state.copy(phase = "dns_started")
    }

    @Synchronized
    override fun connectStart(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy) {
        state = state.copy(phase = "connect_started")
    }

    @Synchronized
    override fun secureConnectStart(call: Call) {
        state = state.copy(phase = "tls_started")
    }

    @Synchronized
    override fun connectionAcquired(call: Call, connection: Connection) {
        state = ProtocolProbeSnapshot(
            phase = "connection_acquired",
            connectionId = System.identityHashCode(connection).toString(),
            connectionProtocol = connection.protocol().toString()
        )
    }

    @Synchronized
    override fun requestHeadersEnd(call: Call, request: Request) {
        state = state.copy(phase = "request_headers_sent")
    }

    @Synchronized
    override fun responseHeadersEnd(call: Call, response: Response) {
        state = state.copy(phase = "response_headers_received")
    }

    @Synchronized
    override fun responseBodyStart(call: Call) {
        state = state.copy(phase = "response_body_started")
    }

    @Synchronized
    override fun responseBodyEnd(call: Call, byteCount: Long) {
        state = state.copy(phase = "response_body_ended")
    }

    @Synchronized
    fun snapshot(): ProtocolProbeSnapshot = state
}
