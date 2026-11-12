package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.ai.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.LocalGuestWorkspaceMigration

/** Files handed to a fresh AI chat together with the request message the chat sends with them. */
data class AiImport(
    val message: String,
    val attachments: List<AiChatAttachment.Binary>
)

data class AiImportOrigin(
    val workspaceId: String,
    val cloudSettings: CloudSettings,
    val configuration: CloudServiceConfiguration,
    val previousGuestMigration: LocalGuestWorkspaceMigration?
)
