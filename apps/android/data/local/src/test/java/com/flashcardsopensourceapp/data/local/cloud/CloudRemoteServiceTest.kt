package com.flashcardsopensourceapp.data.local.cloud

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

class CloudRemoteServiceTest {
    @Test
    fun fetchCloudAccountStopsWhenWorkspacesNextCursorIsJsonNull() = runBlocking {
        val requests = CopyOnWriteArrayList<String>()
        val server = createJsonServer(requests) { exchange ->
            when (exchange.requestURI.path to exchange.requestURI.query) {
                "/me" to null -> jsonResponse(
                    exchange = exchange,
                    statusCode = 200,
                    body = JSONObject()
                        .put("userId", "user-1")
                        .put("selectedWorkspaceId", JSONObject.NULL)
                        .put("profile", JSONObject().put("email", JSONObject.NULL))
                        .toString()
                )

                "/workspaces" to "limit=100" -> jsonResponse(
                    exchange = exchange,
                    statusCode = 200,
                    body = JSONObject()
                        .put(
                            "workspaces",
                            org.json.JSONArray().put(
                                JSONObject()
                                    .put("workspaceId", "workspace-1")
                                    .put("name", "Primary")
                                    .put("createdAt", "2026-03-27T18:59:23.537Z")
                            )
                        )
                        .put("nextCursor", JSONObject.NULL)
                        .toString()
                )

                else -> jsonResponse(exchange = exchange, statusCode = 404, body = "{}")
            }
        }

        server.use {
            val snapshot = CloudRemoteService().fetchCloudAccount(
                apiBaseUrl = it.baseUrl,
                bearerToken = "token-1"
            )

            assertEquals("user-1", snapshot.userId)
            assertNull(snapshot.email)
            assertEquals(1, snapshot.workspaces.size)
            assertFalse(requests.any { request -> request.contains("cursor=null") })
            assertEquals(listOf("/me", "/workspaces?limit=100"), requests)
        }
    }

    @Test
    fun fetchCloudAccountKeepsRealOpaqueCursorAcrossPages() = runBlocking {
        val requests = CopyOnWriteArrayList<String>()
        val nextCursor = "eyJ2YWx1ZXMiOlsiY3Vyc29yLTEiXX0"
        val server = createJsonServer(requests) { exchange ->
            when (exchange.requestURI.path to exchange.requestURI.query) {
                "/me" to null -> jsonResponse(
                    exchange = exchange,
                    statusCode = 200,
                    body = JSONObject()
                        .put("userId", "user-1")
                        .put("selectedWorkspaceId", "workspace-2")
                        .put("profile", JSONObject().put("email", "user@example.com"))
                        .toString()
                )

                "/workspaces" to "limit=100" -> jsonResponse(
                    exchange = exchange,
                    statusCode = 200,
                    body = JSONObject()
                        .put(
                            "workspaces",
                            org.json.JSONArray().put(
                                JSONObject()
                                    .put("workspaceId", "workspace-1")
                                    .put("name", "First")
                                    .put("createdAt", "2026-03-27T18:59:23.537Z")
                            )
                        )
                        .put("nextCursor", nextCursor)
                        .toString()
                )

                "/workspaces" to "limit=100&cursor=$nextCursor" -> jsonResponse(
                    exchange = exchange,
                    statusCode = 200,
                    body = JSONObject()
                        .put(
                            "workspaces",
                            org.json.JSONArray().put(
                                JSONObject()
                                    .put("workspaceId", "workspace-2")
                                    .put("name", "Second")
                                    .put("createdAt", "2026-03-27T19:00:23.537Z")
                            )
                        )
                        .put("nextCursor", JSONObject.NULL)
                        .toString()
                )

                else -> jsonResponse(exchange = exchange, statusCode = 404, body = "{}")
            }
        }

        server.use {
            val snapshot = CloudRemoteService().fetchCloudAccount(
                apiBaseUrl = it.baseUrl,
                bearerToken = "token-1"
            )

            assertEquals(2, snapshot.workspaces.size)
            assertEquals("user@example.com", snapshot.email)
            assertTrue(snapshot.workspaces.any { workspace -> workspace.workspaceId == "workspace-2" && workspace.isSelected })
            assertEquals(
                listOf(
                    "/me",
                    "/workspaces?limit=100",
                    "/workspaces?limit=100&cursor=$nextCursor"
                ),
                requests
            )
        }
    }

    @Test
    fun bootstrapPullTreatsJsonNullCursorAsNull() = runBlocking {
        val requests = CopyOnWriteArrayList<String>()
        val requestBodies = CopyOnWriteArrayList<String>()
        val server = createJsonServer(
            requests = requests,
            requestBodies = requestBodies
        ) { exchange ->
            when (exchange.requestURI.path) {
                "/workspaces/workspace-1/sync/bootstrap" -> jsonResponse(
                    exchange = exchange,
                    statusCode = 200,
                    body = JSONObject()
                        .put("entries", org.json.JSONArray())
                        .put("nextCursor", JSONObject.NULL)
                        .put("hasMore", false)
                        .put("bootstrapHotChangeId", 7)
                        .put("remoteIsEmpty", false)
                        .toString()
                )

                else -> jsonResponse(exchange = exchange, statusCode = 404, body = "{}")
            }
        }

        server.use {
            val response = CloudRemoteService().bootstrapPull(
                apiBaseUrl = it.baseUrl,
                bearerToken = "token-1",
                workspaceId = "workspace-1",
                body = JSONObject()
                    .put("mode", "pull")
                    .put("deviceId", "device-1")
                    .put("platform", "android")
                    .put("appVersion", "0.1.0")
                    .put("cursor", JSONObject.NULL)
                    .put("limit", 100)
            )

            assertNull(response.nextCursor)
            assertFalse(response.hasMore)
            assertEquals(listOf("/workspaces/workspace-1/sync/bootstrap"), requests)
            assertTrue(requestBodies.single().contains("\"cursor\":null"))
        }
    }
}

private class TestJsonServer(
    private val server: HttpServer,
    val baseUrl: String
) : AutoCloseable {
    override fun close() {
        server.stop(0)
    }
}

private fun createJsonServer(
    requests: MutableList<String>,
    requestBodies: MutableList<String> = CopyOnWriteArrayList(),
    handler: (HttpExchange) -> Unit
): TestJsonServer {
    val server = HttpServer.create(InetSocketAddress(0), 0)
    val requestCounter = AtomicInteger(0)
    server.createContext("/") { exchange ->
        requests.add(
            buildString {
                append(exchange.requestURI.path)
                exchange.requestURI.query?.let { query ->
                    append("?")
                    append(query)
                }
            }
        )
        requestBodies.add(
            exchange.requestBody.bufferedReader(StandardCharsets.UTF_8).use { reader ->
                reader.readText()
            }
        )
        exchange.responseHeaders.add("X-Test-Request-Id", "request-${requestCounter.incrementAndGet()}")
        handler(exchange)
    }
    server.start()
    return TestJsonServer(
        server = server,
        baseUrl = "http://127.0.0.1:${server.address.port}"
    )
}

private fun jsonResponse(exchange: HttpExchange, statusCode: Int, body: String) {
    val bytes = body.toByteArray(StandardCharsets.UTF_8)
    exchange.responseHeaders.add("Content-Type", "application/json")
    exchange.sendResponseHeaders(statusCode, bytes.size.toLong())
    exchange.responseBody.use { output ->
        output.write(bytes)
    }
}
