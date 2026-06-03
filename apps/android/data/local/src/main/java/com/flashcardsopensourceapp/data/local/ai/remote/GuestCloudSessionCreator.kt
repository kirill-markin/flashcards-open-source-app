package com.flashcardsopensourceapp.data.local.ai.remote

import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession

interface GuestCloudSessionCreator {
    suspend fun createGuestSession(
        apiBaseUrl: String,
        configurationMode: CloudServiceConfigurationMode
    ): StoredGuestAiSession
}
