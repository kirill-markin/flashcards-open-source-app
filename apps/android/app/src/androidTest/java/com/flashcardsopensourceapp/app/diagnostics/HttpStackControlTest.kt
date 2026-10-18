package com.flashcardsopensourceapp.app.diagnostics

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.app.FirebaseAppInstrumentationTimeoutTest
import com.flashcardsopensourceapp.app.ManualOnlyAndroidTest
import com.flashcardsopensourceapp.data.local.model.cloud.makeOfficialCloudServiceConfiguration
import java.io.IOException
import java.net.URL
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
@ManualOnlyAndroidTest
class HttpStackControlTest : FirebaseAppInstrumentationTimeoutTest() {
    @Test
    fun rawOkHttpGoogleConnectivityCompletes() {
        runOkHttpControl(caseName = "okhttp_google", endpoint = googleControlEndpoint())
    }

    @Test
    fun platformHttpsAuthMethodsComplete() {
        val configuration = makeOfficialCloudServiceConfiguration()
        runPlatformControl(
            caseName = "platform_auth",
            endpoint = StackControlEndpoint("auth", configuration.authBaseUrl, "/api/auth-methods", 200)
        )
    }

    @Test
    fun platformHttpsAgentDiscoveryCompletes() {
        val configuration = makeOfficialCloudServiceConfiguration()
        runPlatformControl(
            caseName = "platform_api",
            endpoint = StackControlEndpoint("api", configuration.apiBaseUrl, "/agent", 200)
        )
    }

    @Test
    fun platformHttpsGoogleConnectivityCompletes() {
        runPlatformControl(caseName = "platform_google", endpoint = googleControlEndpoint())
    }

    private fun runOkHttpControl(caseName: String, endpoint: StackControlEndpoint) {
        val client = OkHttpClient.Builder()
            .connectTimeout(15L, TimeUnit.SECONDS)
            .readTimeout(30L, TimeUnit.SECONDS)
            .writeTimeout(120L, TimeUnit.SECONDS)
            .build()
        val failures: MutableList<Throwable> = mutableListOf()
        try {
            for (requestIndex in 1..6) {
                var statusCode: Int? = null
                var protocol: String? = null
                var bodyRead: Boolean = false
                var ioExceptionClass: String? = null
                var phase: String = "waiting_response"
                val startedAtNanos: Long = System.nanoTime()
                try {
                    val request = Request.Builder().url(endpoint.baseUrl + endpoint.path).get().build()
                    client.newCall(request).execute().use { response ->
                        statusCode = response.code
                        protocol = response.protocol.toString()
                        phase = "reading_body"
                        response.body.bytes()
                        bodyRead = true
                        if (statusCode != endpoint.expectedStatus) {
                            failures.add(AssertionError(
                                "$caseName request $requestIndex expected status ${endpoint.expectedStatus}, got $statusCode."
                            ))
                        }
                    }
                } catch (error: IOException) {
                    ioExceptionClass = error::class.java.name
                    failures.add(error)
                } finally {
                    logControlCompletion(
                        caseName, "raw_okhttp", endpoint, requestIndex, startedAtNanos,
                        statusCode, protocol, bodyRead, ioExceptionClass, phase
                    )
                }
            }
        } finally {
            client.dispatcher.executorService.shutdown()
            client.connectionPool.evictAll()
        }
        failControlCaseIfNeeded(caseName = caseName, failures = failures)
    }

    private fun runPlatformControl(caseName: String, endpoint: StackControlEndpoint) {
        val failures: MutableList<Throwable> = mutableListOf()
        for (requestIndex in 1..6) {
            var connection: HttpsURLConnection? = null
            var statusCode: Int? = null
            var bodyRead: Boolean = false
            var ioExceptionClass: String? = null
            var phase: String = "waiting_response"
            val startedAtNanos: Long = System.nanoTime()
            try {
                val openedConnection = URL(endpoint.baseUrl + endpoint.path).openConnection() as HttpsURLConnection
                connection = openedConnection
                openedConnection.requestMethod = "GET"
                openedConnection.connectTimeout = 15_000
                openedConnection.readTimeout = 30_000
                openedConnection.instanceFollowRedirects = false
                val receivedStatus = openedConnection.responseCode
                statusCode = receivedStatus
                phase = "reading_body"
                val stream = if (receivedStatus >= 400) openedConnection.errorStream else openedConnection.inputStream
                if (stream != null) {
                    stream.use { responseStream -> responseStream.readBytes() }
                }
                bodyRead = true
                if (statusCode != endpoint.expectedStatus) {
                    failures.add(AssertionError(
                        "$caseName request $requestIndex expected status ${endpoint.expectedStatus}, got $statusCode."
                    ))
                }
            } catch (error: IOException) {
                ioExceptionClass = error::class.java.name
                failures.add(error)
            } finally {
                connection?.disconnect()
                logControlCompletion(
                    caseName, "platform_https", endpoint, requestIndex, startedAtNanos,
                    statusCode, null, bodyRead, ioExceptionClass, phase
                )
            }
        }
        failControlCaseIfNeeded(caseName = caseName, failures = failures)
    }

    private fun googleControlEndpoint(): StackControlEndpoint {
        return StackControlEndpoint("google", "https://www.google.com", "/generate_204", 204)
    }

    private fun failControlCaseIfNeeded(caseName: String, failures: List<Throwable>) {
        if (failures.isNotEmpty()) {
            val failure = AssertionError(
                "$caseName HTTP stack control failed ${failures.size} of 6 requests; inspect http_stack_control completion records."
            )
            failures.forEach { cause -> failure.addSuppressed(cause) }
            throw failure
        }
    }

    private fun logControlCompletion(
        caseName: String,
        clientName: String,
        endpoint: StackControlEndpoint,
        requestIndex: Int,
        startedAtNanos: Long,
        statusCode: Int?,
        protocol: String?,
        bodyRead: Boolean,
        ioExceptionClass: String?,
        phase: String
    ) {
        Log.i(
            "HttpStackControl",
            "event=http_stack_control case=$caseName client=$clientName origin=${endpoint.origin} path=${endpoint.path} " +
                "requestIndex=$requestIndex elapsedMs=${TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAtNanos)} " +
                "statusCode=$statusCode bodyRead=$bodyRead protocol=${protocol ?: "unavailable"} " +
                "ioExceptionClass=$ioExceptionClass phase=$phase"
        )
    }
}

private data class StackControlEndpoint(
    val origin: String,
    val baseUrl: String,
    val path: String,
    val expectedStatus: Int
)
