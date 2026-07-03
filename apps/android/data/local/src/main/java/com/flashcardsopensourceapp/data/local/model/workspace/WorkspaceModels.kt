package com.flashcardsopensourceapp.data.local.model.workspace

data class WorkspaceSummary(
    val workspaceId: String,
    val name: String,
    val createdAtMillis: Long
)

data class WorkspaceTagSummary(
    val tag: String,
    val cardsCount: Int
)

data class WorkspaceTagsSummary(
    val tags: List<WorkspaceTagSummary>,
    val totalCards: Int
)

data class WorkspaceOverviewSummary(
    val workspaceId: String,
    val workspaceName: String,
    val totalCards: Int,
    val deckCount: Int,
    val tagsCount: Int,
    val dueCount: Int,
    val newCount: Int,
    val reviewedCount: Int
)
