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
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicInteger

// Frozen test input — intentionally not the real app version; do not bump on release (see docs/version-bump.md).
private const val testAppVersion: String = "1.0.0"

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
                appVersion = testAppVersion,
                versionCode = 123
            )
            val response = client.postJson(
                baseUrl = "http://127.0.0.1:${server.address.port}",
                path = "/workspaces/workspace-1/sync/pull",
                authorizationHeader = null,
                body = JSONObject()
                    .put("installationId", "installation-1")
                    .put("platform", "android")
                    .put("appVersion", testAppVersion)
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
                appVersion = testAppVersion,
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
                        .put("appVersion", testAppVersion)
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

    @Test
    fun postJsonForBytesSendsJsonAndReadsBinaryResponse() = runBlocking {
        val zipBytes = byteArrayOf(0x50.toByte(), 0x4b.toByte(), 0x03.toByte(), 0x04.toByte())
        var requestAcceptHeader: String? = null
        var requestContentTypeHeader: String? = null
        var requestBody: String? = null
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/workspaces/workspace-1/packages/export") { exchange ->
            requestAcceptHeader = exchange.requestHeaders.getFirst("Accept")
            requestContentTypeHeader = exchange.requestHeaders.getFirst("Content-Type")
            requestBody = String(exchange.requestBody.readBytes(), StandardCharsets.UTF_8)
            writeCloudTestBinaryResponse(
                exchange = exchange,
                statusCode = 200,
                body = zipBytes,
                headers = mapOf(
                    "Content-Type" to "application/zip",
                    "Content-Disposition" to "attachment; filename=\"flashcards.zip\""
                )
            )
        }
        server.start()

        try {
            val client = CloudJsonHttpClient(okHttpClient = OkHttpClient())
            val response = client.postJsonForBytes(
                baseUrl = "http://127.0.0.1:${server.address.port}",
                path = "/workspaces/workspace-1/packages/export",
                authorizationHeader = "Bearer token-1",
                body = JSONObject()
                    .put("selection", JSONObject().put("kind", "allActiveCards")),
                acceptHeader = "application/zip"
            )

            assertEquals("application/zip", requestAcceptHeader)
            assertEquals("application/json", requestContentTypeHeader)
            assertEquals("""{"selection":{"kind":"allActiveCards"}}""", requestBody)
            assertArrayEquals(zipBytes, response.bodyBytes)
            assertEquals("application/zip", response.contentType)
            assertEquals("attachment; filename=\"flashcards.zip\"", response.contentDisposition)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun postJsonForBytesRetriesPackageExportTransientGatewayTimeout() = runBlocking {
        val requestCount = AtomicInteger(0)
        val observability = RecordingCloudHttpObservability()
        val zipBytes = byteArrayOf(0x50.toByte(), 0x4b.toByte())
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/workspaces/workspace-1/packages/export") { exchange ->
            val currentRequestCount = requestCount.incrementAndGet()
            if (currentRequestCount == 1) {
                writeCloudTestResponse(
                    exchange = exchange,
                    statusCode = 504,
                    body = "",
                    headers = mapOf("X-Request-Id" to "request-1")
                )
            } else {
                writeCloudTestBinaryResponse(
                    exchange = exchange,
                    statusCode = 200,
                    body = zipBytes,
                    headers = mapOf(
                        "Content-Type" to "application/zip",
                        "Content-Disposition" to "attachment; filename=\"flashcards.zip\""
                    )
                )
            }
        }
        server.start()

        try {
            val client = CloudJsonHttpClient(
                okHttpClient = OkHttpClient(),
                observability = observability,
                appVersion = testAppVersion,
                versionCode = 123
            )
            val response = client.postJsonForBytes(
                baseUrl = "http://127.0.0.1:${server.address.port}",
                path = "/workspaces/workspace-1/packages/export",
                authorizationHeader = null,
                body = JSONObject()
                    .put("selection", JSONObject().put("kind", "allActiveCards")),
                acceptHeader = "application/zip"
            )

            assertArrayEquals(zipBytes, response.bodyBytes)
            assertEquals(2, requestCount.get())
            assertTrue(observability.warnings.isEmpty())
            val retryEvent = observability.breadcrumbs.single()
            assertTrue(retryEvent is AndroidBreadcrumbEvent.HttpTransientRetry)
            retryEvent as AndroidBreadcrumbEvent.HttpTransientRetry
            assertEquals("/workspaces/{workspaceId}/packages/export", retryEvent.endpointName)
            assertEquals("POST", retryEvent.method)
            assertEquals("request-1", retryEvent.requestId)
            assertEquals(504, retryEvent.statusCode)
            assertEquals("http_response", retryEvent.stage)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun mediaAssetDownloadUrlFailureRedactsEndpointIds() = runBlocking {
        val observability = RecordingCloudHttpObservability()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/workspaces/workspace-1/media-assets/media-asset-1/download-url") { exchange ->
            writeCloudTestResponse(
                exchange = exchange,
                statusCode = 400,
                body = """{"code":"MEDIA_TEST_UNEXPECTED","message":"Invalid media test request."}""",
                headers = mapOf("X-Request-Id" to "request-1")
            )
        }
        server.start()

        try {
            val client = CloudJsonHttpClient(
                okHttpClient = OkHttpClient(),
                observability = observability,
                appVersion = testAppVersion,
                versionCode = 123
            )
            var thrownError: CloudRemoteException? = null
            try {
                client.getJson(
                    baseUrl = "http://127.0.0.1:${server.address.port}",
                    path = "/workspaces/workspace-1/media-assets/media-asset-1/download-url",
                    authorizationHeader = null
                )
            } catch (error: CloudRemoteException) {
                thrownError = error
            }

            val error = thrownError ?: throw AssertionError("Expected CloudRemoteException")
            assertEquals(400, error.statusCode)
            val warning = observability.warnings.single()
            assertTrue(warning is AndroidWarningIssueEvent.HttpUnexpectedClientError)
            warning as AndroidWarningIssueEvent.HttpUnexpectedClientError
            assertEquals("/workspaces/{workspaceId}/media-assets/{mediaAssetId}/download-url", warning.endpointName)
            assertEquals("request-1", warning.requestId)
        } finally {
            server.stop(0)
        }
    }
}

private fun writeCloudTestBinaryResponse(
    exchange: HttpExchange,
    statusCode: Int,
    body: ByteArray,
    headers: Map<String, String>
) {
    headers.forEach { (name, value) ->
        exchange.responseHeaders.add(name, value)
    }
    exchange.sendResponseHeaders(statusCode, body.size.toLong())
    exchange.responseBody.use { output ->
        output.write(body)
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
