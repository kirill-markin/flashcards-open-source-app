package com.flashcardsopensourceapp.data.local.ai.remote

import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession

interface GuestCloudSessionCreator {
    /**
     * [idempotencyKey] must be 32 to 200 lowercase hexadecimal characters from a cryptographic
     * random source. A retry carrying it rotates the named session's secret and returns the same
     * guest user and workspace instead of minting a second identity, so a key derived from an
     * install id or any other stable value would be a bearer credential for that guest.
     */
    suspend fun createGuestSession(
        apiBaseUrl: String,
        configurationMode: CloudServiceConfigurationMode,
        idempotencyKey: String
    ): StoredGuestAiSession
}
