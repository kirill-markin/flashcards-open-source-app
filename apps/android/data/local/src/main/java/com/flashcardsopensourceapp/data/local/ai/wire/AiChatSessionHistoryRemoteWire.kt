package com.flashcardsopensourceapp.data.local.ai.wire

import com.flashcardsopensourceapp.data.local.model.ai.AiChatArchivedSession
import com.flashcardsopensourceapp.data.local.model.ai.AiChatSessionHistoryPage
import com.flashcardsopensourceapp.data.local.model.ai.AiChatSessionHistorySummary
import kotlinx.serialization.Serializable

@Serializable
private data class AiChatSessionHistorySummaryWire(
    val sessionId: StrictRemoteString,
    val title: StrictRemoteString?,
    val hasCustomTitle: StrictRemoteBoolean,
    val preview: StrictRemoteString?,
    val messageCount: StrictRemoteInt,
    val createdAt: StrictRemoteLong,
    val lastActivityAt: StrictRemoteLong
)

@Serializable
private data class AiChatSessionsListResponseWire(
    val sessions: List<AiChatSessionHistorySummaryWire>,
    val nextCursor: StrictRemoteString?
)

@Serializable
private data class AiChatArchivedSessionWire(
    val sessionId: StrictRemoteString,
    val archivedAt: StrictRemoteLong
)

internal fun decodeAiChatSessionHistoryPage(payload: String): AiChatSessionHistoryPage {
    val wire = decodeAiChatWire<AiChatSessionsListResponseWire>(payload = payload, context = "chat.sessions")
    return AiChatSessionHistoryPage(
        sessions = wire.sessions.map(AiChatSessionHistorySummaryWire::asDomain),
        nextCursor = wire.nextCursor?.value
    )
}

internal fun decodeAiChatRenamedSession(payload: String): AiChatSessionHistorySummary {
    val wire = decodeAiChatWire<AiChatSessionHistorySummaryWire>(payload = payload, context = "chat.sessions.rename")
    return wire.asDomain()
}

internal fun decodeAiChatArchivedSession(payload: String): AiChatArchivedSession {
    val wire = decodeAiChatWire<AiChatArchivedSessionWire>(payload = payload, context = "chat.sessions.archive")
    return AiChatArchivedSession(
        sessionId = wire.sessionId.value,
        archivedAtMillis = wire.archivedAt.value
    )
}

private fun AiChatSessionHistorySummaryWire.asDomain(): AiChatSessionHistorySummary {
    return AiChatSessionHistorySummary(
        sessionId = this.sessionId.value,
        title = this.title?.value,
        hasCustomTitle = this.hasCustomTitle.value,
        preview = this.preview?.value,
        messageCount = this.messageCount.value,
        createdAtMillis = this.createdAt.value,
        lastActivityAtMillis = this.lastActivityAt.value
    )
}
