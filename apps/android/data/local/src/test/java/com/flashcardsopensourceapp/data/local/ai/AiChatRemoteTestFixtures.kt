package com.flashcardsopensourceapp.data.local.ai

import com.sun.net.httpserver.HttpExchange
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import kotlinx.coroutines.Dispatchers

internal const val AI_CHAT_TEST_APP_VERSION: String = "1.2.2"
internal const val AI_CHAT_TEST_UI_LOCALE: String = "es-ES"
internal const val AI_CHAT_TEST_WORKSPACE_ID: String = "workspace-1"

internal fun makeAiChatTestDispatchers(): AiCoroutineDispatchers {
    return AiCoroutineDispatchers(io = Dispatchers.IO)
}

internal fun makeAiChatTestLiveRemoteService(): AiChatLiveRemoteService {
    return AiChatLiveRemoteService(dispatchers = makeAiChatTestDispatchers())
}

internal fun makeAiChatTestRemoteService(): AiChatRemoteService {
    return AiChatRemoteService(
        dispatchers = makeAiChatTestDispatchers(),
        liveRemoteService = makeAiChatTestLiveRemoteService()
    )
}

internal fun parseAiChatTestQueryParameters(rawQuery: String?): Map<String, String> {
    if (rawQuery.isNullOrBlank()) {
        return emptyMap()
    }

    return rawQuery.split("&")
        .filter(String::isNotBlank)
        .associate { entry ->
            val separatorIndex = entry.indexOf('=')
            if (separatorIndex < 0) {
                URLDecoder.decode(entry, StandardCharsets.UTF_8) to ""
            } else {
                URLDecoder.decode(entry.substring(startIndex = 0, endIndex = separatorIndex), StandardCharsets.UTF_8) to
                    URLDecoder.decode(entry.substring(startIndex = separatorIndex + 1), StandardCharsets.UTF_8)
            }
        }
}

internal fun writeAiChatTestJsonResponse(exchange: HttpExchange, body: String) {
    val responseBytes = body.toByteArray(StandardCharsets.UTF_8)
    exchange.sendResponseHeaders(200, responseBytes.size.toLong())
    exchange.responseBody.use { outputStream -> outputStream.write(responseBytes) }
}

internal fun writeAiChatTestSseResponse(exchange: HttpExchange, body: String) {
    val responseBytes = body.toByteArray(StandardCharsets.UTF_8)
    exchange.responseHeaders.add("Content-Type", "text/event-stream")
    exchange.sendResponseHeaders(200, responseBytes.size.toLong())
    exchange.responseBody.use { outputStream -> outputStream.write(responseBytes) }
}
