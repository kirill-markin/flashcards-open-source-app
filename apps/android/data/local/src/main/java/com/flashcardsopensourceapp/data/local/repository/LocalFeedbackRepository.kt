package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.feedback.CloudFeedbackPromptEventRequest
import com.flashcardsopensourceapp.data.local.model.feedback.CloudFeedbackPromptEventType
import com.flashcardsopensourceapp.data.local.model.feedback.CloudFeedbackState
import com.flashcardsopensourceapp.data.local.model.feedback.CloudFeedbackSubmissionRequest
import com.flashcardsopensourceapp.data.local.model.feedback.CloudFeedbackTrigger
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.feedback.cloudFeedbackMessageMaximumLength
import com.flashcardsopensourceapp.data.local.model.cloud.formatIsoTimestamp
import com.flashcardsopensourceapp.data.local.model.cloud.shouldRefreshCloudIdToken
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.CloudGuestSessionCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.GuestCloudSessionRestoreResult
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.androidClientPlatform
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.loadCurrentWorkspaceOrNull
import java.time.ZoneId
import java.util.Locale
import java.util.UUID

private data class AuthorizedFeedbackSession(
    val apiBaseUrl: String,
    val authorizationHeader: String,
    val workspaceId: String?,
    val installationId: String
)

class LocalFeedbackRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val cloudGuestSessionCoordinator: CloudGuestSessionCoordinator,
    private val syncRepository: SyncRepository,
    private val appVersion: String
) : FeedbackRepository {
    override suspend fun loadFeedbackStateForExistingCloudSession(): CloudFeedbackState? {
        val session = authorizedSession(createGuestSessionIfMissing = false) ?: return null
        return remoteService.loadFeedbackState(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader
        )
    }

    override suspend fun recordAutomaticPromptShownForExistingCloudSession(): CloudFeedbackState? {
        val session = authorizedSession(createGuestSessionIfMissing = false) ?: return null
        return remoteService.recordFeedbackPromptEvent(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            request = CloudFeedbackPromptEventRequest(
                feedbackPromptEventId = makeFeedbackClientId(),
                workspaceId = session.workspaceId,
                installationId = session.installationId,
                platform = androidClientPlatform,
                appVersion = appVersion,
                locale = currentLocaleTag(),
                timezone = currentTimeZoneId(),
                eventType = CloudFeedbackPromptEventType.AUTOMATIC_PROMPT_SHOWN,
                createdAtClient = formatIsoTimestamp(timestampMillis = System.currentTimeMillis())
            )
        )
    }

    override suspend fun submitFeedback(
        trigger: CloudFeedbackTrigger,
        message: String
    ): CloudFeedbackState {
        val trimmedMessage = message.trim()
        require(trimmedMessage.isNotEmpty()) {
            "Feedback message must not be empty."
        }
        require(trimmedMessage.length <= cloudFeedbackMessageMaximumLength) {
            "Feedback message must be $cloudFeedbackMessageMaximumLength characters or fewer."
        }

        val session = requireNotNull(authorizedSession(createGuestSessionIfMissing = true)) {
            "Feedback submission requires a cloud session."
        }
        return remoteService.submitFeedback(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            request = CloudFeedbackSubmissionRequest(
                feedbackSubmissionId = makeFeedbackClientId(),
                workspaceId = session.workspaceId,
                installationId = session.installationId,
                platform = androidClientPlatform,
                appVersion = appVersion,
                locale = currentLocaleTag(),
                timezone = currentTimeZoneId(),
                trigger = trigger,
                message = trimmedMessage,
                createdAtClient = formatIsoTimestamp(timestampMillis = System.currentTimeMillis())
            )
        )
    }

    private suspend fun authorizedSession(createGuestSessionIfMissing: Boolean): AuthorizedFeedbackSession? {
        val currentWorkspace: WorkspaceEntity? = loadCurrentWorkspaceOrNull(
            database = database,
            preferencesStore = preferencesStore
        )
        val reconciliation = cloudGuestSessionCoordinator.reconcilePersistedCloudState()
        val configuration = preferencesStore.currentServerConfiguration()
        if (reconciliation.cloudSettings.cloudState == CloudAccountState.LINKED) {
            val credentials = refreshedCredentials(
                storedCredentials = requireNotNull(preferencesStore.loadCredentials()) {
                    "Cloud account is not signed in."
                },
                authBaseUrl = configuration.authBaseUrl
            )
            val cloudSettings = preferencesStore.currentCloudSettings()
            return AuthorizedFeedbackSession(
                apiBaseUrl = configuration.apiBaseUrl,
                authorizationHeader = "Bearer ${credentials.idToken}",
                workspaceId = currentWorkspace?.workspaceId,
                installationId = cloudSettings.installationId
            )
        }
        if (createGuestSessionIfMissing.not() && reconciliation.cloudSettings.cloudState != CloudAccountState.GUEST) {
            return null
        }

        val guestSession = if (reconciliation.cloudSettings.cloudState == CloudAccountState.GUEST) {
            GuestCloudSessionRestoreResult(
                session = requireNotNull(reconciliation.restoredGuestSession) {
                    "Guest cloud state is missing a stored guest session."
                },
                shouldSync = reconciliation.guestRestoreRequiresSync
            )
        } else {
            cloudGuestSessionCoordinator.restoreGuestCloudSessionIfNeeded(
                workspaceId = currentWorkspace?.workspaceId,
                createSessionIfMissing = createGuestSessionIfMissing
            )
        }
        if (guestSession.shouldSync) {
            syncRepository.syncNow()
        }

        val cloudSettings = preferencesStore.currentCloudSettings()
        return AuthorizedFeedbackSession(
            apiBaseUrl = guestSession.session.apiBaseUrl,
            authorizationHeader = "Guest ${guestSession.session.guestToken}",
            workspaceId = guestSession.session.workspaceId,
            installationId = cloudSettings.installationId
        )
    }

    private suspend fun refreshedCredentials(
        storedCredentials: StoredCloudCredentials,
        authBaseUrl: String
    ): StoredCloudCredentials {
        if (
            shouldRefreshCloudIdToken(
                idTokenExpiresAtMillis = storedCredentials.idTokenExpiresAtMillis,
                nowMillis = System.currentTimeMillis()
            ).not()
        ) {
            return storedCredentials
        }

        return remoteService.refreshIdToken(
            refreshToken = storedCredentials.refreshToken,
            authBaseUrl = authBaseUrl
        ).also(preferencesStore::saveCredentials)
    }
}

private fun makeFeedbackClientId(): String {
    return UUID.randomUUID().toString()
}

private fun currentLocaleTag(): String {
    return Locale.getDefault().toLanguageTag()
}

private fun currentTimeZoneId(): String {
    return ZoneId.systemDefault().id
}
