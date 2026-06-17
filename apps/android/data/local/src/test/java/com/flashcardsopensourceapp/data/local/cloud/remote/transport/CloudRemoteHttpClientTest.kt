package com.flashcardsopensourceapp.data.local.cloud.remote.transport

import com.flashcardsopensourceapp.core.observability.AndroidBreadcrumbEvent
import com.flashcardsopensourceapp.core.observability.AndroidExceptionIssueEvent
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.core.observability.CloudObservationIdentity
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicInteger

class CloudRemoteHttpClientTest {
    @Test
    fun syncPullRetriesTransientGatewayTimeoutBeforeCapturingWarning() = runBlocking {
        val requestCount = AtomicInteger(0)
        val observability = RecordingCloudHttpObservability()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/workspaces/workspace-1/sync/pull") { exchange ->
            val currentRequestCount = requestCount.incrementAndGet()
            if (currentRequestCount == 1) {
                writeCloudTestResponse(
                    exchange = exchange,
                    statusCode = 504,
                    body = "",
                    headers = mapOf("X-Amz-Apigw-Id" to "gateway-request-1")
                )
            } else {
                writeCloudTestResponse(
                    exchange = exchange,
                    statusCode = 200,
                    body = """{"changes":[],"nextHotChangeId":42,"hasMore":false}""",
                    headers = emptyMap()
                )
            }
        }
        server.start()

        try {
            val client = CloudJsonHttpClient(
                okHttpClient = OkHttpClient(),
                observability = observability,
                appVersion = "1.13.0",
                versionCode = 123
            )
            val response = client.postJson(
                baseUrl = "http://127.0.0.1:${server.address.port}",
                path = "/workspaces/workspace-1/sync/pull",
                authorizationHeader = null,
                body = JSONObject()
                    .put("installationId", "installation-1")
                    .put("platform", "android")
                    .put("appVersion", "1.13.0")
                    .put("afterHotChangeId", 0)
                    .put("limit", 200)
            )

            assertEquals(42L, response.getLong("nextHotChangeId"))
            assertEquals(2, requestCount.get())
            assertTrue(observability.warnings.isEmpty())
            val retryEvent = observability.breadcrumbs.single()
            assertTrue(retryEvent is AndroidBreadcrumbEvent.HttpTransientRetry)
            retryEvent as AndroidBreadcrumbEvent.HttpTransientRetry
            assertEquals("/workspaces/{workspaceId}/sync/pull", retryEvent.endpointName)
            assertEquals("POST", retryEvent.method)
            assertEquals("gateway-request-1", retryEvent.requestId)
            assertEquals(504, retryEvent.statusCode)
            assertEquals("http_response", retryEvent.stage)
            assertEquals(1, retryEvent.attemptNumber)
            assertEquals(4, retryEvent.maxAttemptCount)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun syncBootstrapPushDoesNotRetryTransientGatewayTimeout() = runBlocking {
        val requestCount = AtomicInteger(0)
        val observability = RecordingCloudHttpObservability()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/workspaces/workspace-1/sync/bootstrap") { exchange ->
            requestCount.incrementAndGet()
            writeCloudTestResponse(
                exchange = exchange,
                statusCode = 504,
                body = "",
                headers = mapOf("X-Amzn-RequestId" to "lambda-request-1")
            )
        }
        server.start()

        try {
            val client = CloudJsonHttpClient(
                okHttpClient = OkHttpClient(),
                observability = observability,
                appVersion = "1.13.0",
                versionCode = 123
            )
            var thrownError: CloudRemoteException? = null
            try {
                client.postJson(
                    baseUrl = "http://127.0.0.1:${server.address.port}",
                    path = "/workspaces/workspace-1/sync/bootstrap",
                    authorizationHeader = null,
                    body = JSONObject()
                        .put("mode", "push")
                        .put("installationId", "installation-1")
                        .put("platform", "android")
                        .put("appVersion", "1.13.0")
                        .put("entries", JSONArray())
                )
            } catch (error: CloudRemoteException) {
                thrownError = error
            }

            val error = thrownError ?: throw AssertionError("Expected CloudRemoteException")
            assertEquals(504, error.statusCode)
            assertEquals("lambda-request-1", error.requestId)
            assertEquals(1, requestCount.get())
            assertTrue(observability.breadcrumbs.isEmpty())
            val warning = observability.warnings.single()
            assertTrue(warning is AndroidWarningIssueEvent.HttpServerError)
            warning as AndroidWarningIssueEvent.HttpServerError
            assertEquals("/workspaces/{workspaceId}/sync/bootstrap", warning.endpointName)
            assertEquals("lambda-request-1", warning.requestId)
        } finally {
            server.stop(0)
        }
    }
}

private class RecordingCloudHttpObservability : AppObservability {
    val breadcrumbs: MutableList<AndroidBreadcrumbEvent> = mutableListOf()
    val warnings: MutableList<AndroidWarningIssueEvent> = mutableListOf()

    override fun setCloudIdentity(identity: CloudObservationIdentity) {
    }

    override fun clearCloudIdentity() {
    }

    override fun addBreadcrumb(event: AndroidBreadcrumbEvent) {
        breadcrumbs += event
    }

    override fun captureWarning(event: AndroidWarningIssueEvent) {
        warnings += event
    }

    override fun captureException(event: AndroidExceptionIssueEvent) {
    }
}

private fun writeCloudTestResponse(
    exchange: HttpExchange,
    statusCode: Int,
    body: String,
    headers: Map<String, String>
) {
    headers.forEach { (name, value) ->
        exchange.responseHeaders.add(name, value)
    }
    val responseBytes = body.toByteArray(StandardCharsets.UTF_8)
    exchange.sendResponseHeaders(
        statusCode,
        if (responseBytes.isEmpty()) -1L else responseBytes.size.toLong()
    )
    if (responseBytes.isEmpty()) {
        exchange.responseBody.close()
    } else {
        exchange.responseBody.use { output ->
            output.write(responseBytes)
        }
    }
}
