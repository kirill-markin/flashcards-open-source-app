package com.flashcardsopensourceapp.data.local.cloud.remote

import com.flashcardsopensourceapp.data.local.model.cloud.CloudConnectionAction
import com.flashcardsopensourceapp.data.local.model.cloud.CloudConnectionResponse

import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.core.observability.ClientDeviceType
import com.flashcardsopensourceapp.data.local.cloud.remote.billing.CloudPaywallRemoteApi
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPaywallState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPaywallImpression
import com.flashcardsopensourceapp.data.local.cloud.remote.billing.CloudGoogleBillingGateway
import com.flashcardsopensourceapp.data.local.cloud.remote.billing.CloudGoogleBillingRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.billing.GooglePurchaseIntent
import com.flashcardsopensourceapp.data.local.cloud.remote.agent.CloudAgentConnectionRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.auth.CloudAuthRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.auth.CloudAccountMethodsGateway
import com.flashcardsopensourceapp.data.local.cloud.remote.auth.CloudAccountMethodsRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.auth.CloudAccountMethodSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethods
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodAttempt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodReceipt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodIntent
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodProof
import com.flashcardsopensourceapp.data.local.model.cloud.CloudProviderMethodTarget
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodPurpose
import com.flashcardsopensourceapp.data.local.cloud.remote.auth.CloudSocialAuthGateway
import com.flashcardsopensourceapp.data.local.cloud.remote.auth.CloudSocialAuthRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.community.CloudCommunityProfileRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.feedback.CloudFeedbackRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.guest.CloudGuestUpgradeRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.media.CloudMediaAssetRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.progress.CloudProgressRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.CloudSyncRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteBootstrapPushResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemotePullResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemotePushResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteReviewHistoryImportResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteReviewHistoryPullResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudHttpObservationVersions
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.NoopCloudHttpObservability
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.createCloudHttpObservationVersions
import com.flashcardsopensourceapp.data.local.cloud.remote.workspace.CloudAccountWorkspaceRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.workspace.CloudWorkspacePackageRemoteApi
import com.flashcardsopensourceapp.data.local.model.cloud.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAuthMethods
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialCredentialResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginAttempt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginCompletion
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginSession
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferences
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferencesUpdate
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.feedback.CloudFeedbackPromptEventRequest
import com.flashcardsopensourceapp.data.local.model.feedback.CloudFeedbackState
import com.flashcardsopensourceapp.data.local.model.feedback.CloudFeedbackSubmissionRequest
import com.flashcardsopensourceapp.data.local.model.media.CompleteMediaAssetUploadSessionRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetDownloadUrl
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadCompletion
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartUrlsRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartUrlsResponse
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionAbort
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionCreateRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionCreateResponse
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeCompletion
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradePreparation
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCommunityProfile
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateRequest
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateResponse
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEmailSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardProfile
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportDownloadResponse
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportRequest
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmOptions
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmResult
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportPreview
import okhttp3.OkHttpClient
import org.json.JSONObject

class CloudRemoteService private constructor(
    okHttpClient: OkHttpClient,
    observability: AppObservability,
    observationVersions: CloudHttpObservationVersions,
    isAutomation: Boolean,
    clientDeviceTypeProvider: () -> ClientDeviceType?
) : CloudRemoteGateway, CloudGoogleBillingGateway, CloudSocialAuthGateway, CloudAccountMethodsGateway {
    constructor(
        okHttpClient: OkHttpClient,
        observability: AppObservability,
        appVersion: String,
        versionCode: Int,
        isAutomation: Boolean,
        clientDeviceTypeProvider: () -> ClientDeviceType
    ) : this(
        okHttpClient = okHttpClient,
        observability = observability,
        observationVersions = createCloudHttpObservationVersions(
            appVersion = appVersion,
            versionCode = versionCode
        ),
        isAutomation = isAutomation,
        clientDeviceTypeProvider = clientDeviceTypeProvider
    )

    // No app version, no automation declaration, and no device type. Today's only caller probes
    // cloud configuration, which registers no installation; nothing here prevents a future caller
    // from syncing through it, and such a caller would send unmarked bodies, so give it the
    // constructor that takes `isAutomation` and the device type instead.
    constructor(okHttpClient: OkHttpClient) : this(
        okHttpClient = okHttpClient,
        observability = NoopCloudHttpObservability,
        observationVersions = createCloudHttpObservationVersions(
            appVersion = null,
            versionCode = null
        ),
        isAutomation = false,
        clientDeviceTypeProvider = { null }
    )

    constructor() : this(okHttpClient = OkHttpClient())

    private val httpClient = CloudJsonHttpClient(
        okHttpClient = okHttpClient,
        observability = observability,
        observationVersions = observationVersions
    )
    private val authApi = CloudAuthRemoteApi(httpClient = httpClient)
    private val socialAuthApi = CloudSocialAuthRemoteApi(httpClient = httpClient)
    private val accountMethodsApi = CloudAccountMethodsRemoteApi(httpClient)
    private val paywallApi = CloudPaywallRemoteApi(httpClient)
    private val googleBillingApi = CloudGoogleBillingRemoteApi(httpClient = httpClient)
    private val guestUpgradeApi = CloudGuestUpgradeRemoteApi(httpClient = httpClient)
    private val accountWorkspaceApi = CloudAccountWorkspaceRemoteApi(httpClient = httpClient)
    private val progressApi = CloudProgressRemoteApi(httpClient = httpClient)
    private val communityProfileApi = CloudCommunityProfileRemoteApi(httpClient = httpClient)
    private val feedbackApi = CloudFeedbackRemoteApi(httpClient = httpClient)
    private val mediaAssetApi = CloudMediaAssetRemoteApi(httpClient = httpClient)
    private val agentConnectionApi = CloudAgentConnectionRemoteApi(httpClient = httpClient)
    private val syncApi = CloudSyncRemoteApi(
        httpClient = httpClient,
        isAutomation = isAutomation,
        clientDeviceTypeProvider = clientDeviceTypeProvider
    )
    private val workspacePackageApi = CloudWorkspacePackageRemoteApi(httpClient = httpClient)

    suspend fun loadPaywallState(apiBaseUrl: String, authorizationHeader: String): CloudPaywallState =
        paywallApi.load(apiBaseUrl, authorizationHeader)

    suspend fun recordPaywallShown(
        apiBaseUrl: String,
        authorizationHeader: String,
        impression: CloudPaywallImpression
    ): CloudPaywallState =
        paywallApi.record(apiBaseUrl, authorizationHeader, impression)

    override suspend fun accountConnection(session: CloudAccountMethodSession, verifier: String, action: CloudConnectionAction): CloudConnectionResponse =
        accountMethodsApi.accountConnection(session, verifier, action)

    override suspend fun loadAccountMethods(session: CloudAccountMethodSession): CloudAccountMethods = accountMethodsApi.loadAccountMethods(session)
    override suspend fun beginEmailReauthentication(session: CloudAccountMethodSession, codeChallenge: String): CloudAccountMethodAttempt =
        accountMethodsApi.beginEmailReauthentication(session, codeChallenge)
    override suspend fun completeEmailReauthentication(session: CloudAccountMethodSession, attempt: String, codeVerifier: String, code: String): CloudAccountMethodReceipt =
        accountMethodsApi.completeEmailReauthentication(session, attempt, codeVerifier, code)
    override suspend fun beginAccountProvider(session: CloudAccountMethodSession, provider: CloudSocialProvider, intent: CloudAccountMethodIntent,
        codeChallenge: String, proof: CloudAccountMethodProof?, target: CloudProviderMethodTarget?): CloudAccountMethodAttempt =
        accountMethodsApi.beginAccountProvider(session, provider, intent, codeChallenge, proof, target)
    override suspend fun submitAccountGoogle(session: CloudAccountMethodSession, intent: CloudAccountMethodIntent, attempt: String,
        codeVerifier: String, identityToken: String): CloudAccountMethodResult = accountMethodsApi.submitAccountGoogle(session, intent, attempt, codeVerifier, identityToken)
    override suspend fun sendAccountMailbox(session: CloudAccountMethodSession, purpose: CloudAccountMethodPurpose, attempt: String, codeVerifier: String, email: String) =
        accountMethodsApi.sendAccountMailbox(session, purpose, attempt, codeVerifier, email)
    override suspend fun verifyAccountMailbox(session: CloudAccountMethodSession, purpose: CloudAccountMethodPurpose, attempt: String, codeVerifier: String, code: String): CloudAccountMethodReceipt =
        accountMethodsApi.verifyAccountMailbox(session, purpose, attempt, codeVerifier, code)
    override suspend fun redeemAccountLink(session: CloudAccountMethodSession, completion: String, codeVerifier: String) = accountMethodsApi.redeemAccountLink(session, completion, codeVerifier)
    override suspend fun resumeAppleReenable(session: CloudAccountMethodSession, attempt: String, codeVerifier: String) = accountMethodsApi.resumeAppleReenable(session, attempt, codeVerifier)
    override suspend fun unlinkAccountProvider(session: CloudAccountMethodSession, target: CloudProviderMethodTarget, proof: CloudAccountMethodProof) = accountMethodsApi.unlinkAccountProvider(session, target, proof)

    override suspend fun loadAuthMethods(authBaseUrl: String): CloudAuthMethods {
        return socialAuthApi.loadAuthMethods(authBaseUrl)
    }

    override suspend fun beginGoogleLogin(authBaseUrl: String, codeChallenge: String): CloudSocialLoginAttempt {
        return socialAuthApi.beginGoogleLogin(authBaseUrl, codeChallenge)
    }

    override suspend fun submitGoogleCredential(
        authBaseUrl: String,
        attempt: String,
        codeVerifier: String,
        identityToken: String
    ): CloudSocialCredentialResult {
        return socialAuthApi.submitGoogleCredential(authBaseUrl, attempt, codeVerifier, identityToken)
    }

    override suspend fun requestSocialMailboxCode(
        authBaseUrl: String,
        attempt: String,
        codeVerifier: String,
        email: String
    ) {
        socialAuthApi.requestSocialMailboxCode(authBaseUrl, attempt, codeVerifier, email)
    }

    override suspend fun verifySocialMailboxCode(
        authBaseUrl: String,
        attempt: String,
        codeVerifier: String,
        code: String
    ): CloudSocialLoginCompletion {
        return socialAuthApi.verifySocialMailboxCode(authBaseUrl, attempt, codeVerifier, code)
    }

    override suspend fun redeemSocialLogin(
        authBaseUrl: String,
        completion: String,
        codeVerifier: String
    ): CloudSocialLoginSession {
        return socialAuthApi.redeemSocialLogin(authBaseUrl, completion, codeVerifier)
    }

    override suspend fun loadGoogleBillingAccount(apiBaseUrl: String, authorizationHeader: String): String {
        return googleBillingApi.loadGoogleBillingAccount(apiBaseUrl, authorizationHeader)
    }

    override suspend fun verifyGooglePurchase(
        apiBaseUrl: String,
        authorizationHeader: String,
        purchaseToken: String,
        intent: GooglePurchaseIntent
    ) {
        googleBillingApi.verifyGooglePurchase(apiBaseUrl, authorizationHeader, purchaseToken, intent)
    }

    override suspend fun validateConfiguration(configuration: CloudServiceConfiguration) {
        requireAuthHealthResponse(
            response = httpClient.getJson(
                baseUrl = configuration.authBaseUrl,
                path = "/health",
                authorizationHeader = null
            )
        )
        requireApiHealthResponse(
            response = httpClient.getJson(
                baseUrl = configuration.apiBaseUrl,
                path = "/health",
                authorizationHeader = null
            )
        )
    }

    override suspend fun sendCode(email: String, authBaseUrl: String): CloudSendCodeResult {
        return authApi.sendCode(email = email, authBaseUrl = authBaseUrl)
    }

    override suspend fun verifyCodeSession(
        challenge: CloudOtpChallenge,
        code: String,
        authBaseUrl: String
    ): CloudEmailSession = authApi.verifyCodeSession(challenge, code, authBaseUrl)

    override suspend fun verifyCode(
        challenge: CloudOtpChallenge,
        code: String,
        authBaseUrl: String
    ): StoredCloudCredentials {
        return authApi.verifyCode(challenge = challenge, code = code, authBaseUrl = authBaseUrl)
    }

    override suspend fun refreshIdToken(refreshToken: String, authBaseUrl: String): StoredCloudCredentials {
        return authApi.refreshIdToken(refreshToken = refreshToken, authBaseUrl = authBaseUrl)
    }

    override suspend fun deleteGuestSession(apiBaseUrl: String, guestToken: String) {
        guestUpgradeApi.deleteGuestSession(apiBaseUrl = apiBaseUrl, guestToken = guestToken)
    }

    override suspend fun fetchCloudAccount(apiBaseUrl: String, authorizationHeader: String): CloudAccountSnapshot {
        return accountWorkspaceApi.fetchCloudAccount(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader
        )
    }

    override suspend fun updateAccountPreferences(
        apiBaseUrl: String,
        authorizationHeader: String,
        update: AccountPreferencesUpdate
    ): AccountPreferences {
        return accountWorkspaceApi.updateAccountPreferences(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            update = update
        )
    }

    override suspend fun listLinkedWorkspaces(
        apiBaseUrl: String,
        bearerToken: String
    ): List<CloudWorkspaceSummary> {
        return accountWorkspaceApi.listLinkedWorkspaces(apiBaseUrl = apiBaseUrl, bearerToken = bearerToken)
    }

    override suspend fun linkGuestIdentity(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String
    ) {
        guestUpgradeApi.linkGuestIdentity(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            guestToken = guestToken
        )
    }

    override suspend fun prepareGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String
    ): CloudGuestUpgradePreparation {
        return guestUpgradeApi.prepareGuestUpgrade(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            guestToken = guestToken
        )
    }

    override suspend fun completeGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String,
        selection: CloudGuestUpgradeSelection,
        guestWorkspaceSyncedAndOutboxDrained: Boolean,
        supportsDroppedEntities: Boolean
    ): CloudGuestUpgradeCompletion {
        return guestUpgradeApi.completeGuestUpgrade(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            guestToken = guestToken,
            selection = selection,
            guestWorkspaceSyncedAndOutboxDrained = guestWorkspaceSyncedAndOutboxDrained,
            supportsDroppedEntities = supportsDroppedEntities
        )
    }

    override suspend fun createWorkspace(apiBaseUrl: String, bearerToken: String, name: String): CloudWorkspaceSummary {
        return accountWorkspaceApi.createWorkspace(apiBaseUrl = apiBaseUrl, bearerToken = bearerToken, name = name)
    }

    override suspend fun selectWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceSummary {
        return accountWorkspaceApi.selectWorkspace(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            workspaceId = workspaceId
        )
    }

    override suspend fun renameWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        name: String
    ): CloudWorkspaceSummary {
        return accountWorkspaceApi.renameWorkspace(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            workspaceId = workspaceId,
            name = name
        )
    }

    override suspend fun loadWorkspaceDeletePreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceDeletePreview {
        return accountWorkspaceApi.loadWorkspaceDeletePreview(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            workspaceId = workspaceId
        )
    }

    override suspend fun deleteWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ): CloudWorkspaceDeleteResult {
        return accountWorkspaceApi.deleteWorkspace(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            workspaceId = workspaceId,
            confirmationText = confirmationText
        )
    }

    override suspend fun loadWorkspaceResetProgressPreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceResetProgressPreview {
        return accountWorkspaceApi.loadWorkspaceResetProgressPreview(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            workspaceId = workspaceId
        )
    }

    override suspend fun resetWorkspaceProgress(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ): CloudWorkspaceResetProgressResult {
        return accountWorkspaceApi.resetWorkspaceProgress(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            workspaceId = workspaceId,
            confirmationText = confirmationText
        )
    }

    override suspend fun previewWorkspacePackageExport(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        request: WorkspacePackageExportRequest
    ): WorkspacePackageExportPreview {
        return workspacePackageApi.previewWorkspacePackageExport(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            request = request
        )
    }

    override suspend fun exportWorkspacePackage(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        request: WorkspacePackageExportRequest
    ): WorkspacePackageExportDownloadResponse {
        return workspacePackageApi.exportWorkspacePackage(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            request = request
        )
    }

    override suspend fun previewWorkspacePackageImport(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        packageBytes: ByteArray
    ): WorkspacePackageImportPreview {
        return workspacePackageApi.previewWorkspacePackageImport(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            packageBytes = packageBytes
        )
    }

    override suspend fun confirmWorkspacePackageImport(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        fileName: String,
        packageBytes: ByteArray,
        lastModifiedByReplicaId: String,
        options: WorkspacePackageImportConfirmOptions
    ): WorkspacePackageImportConfirmResult {
        return workspacePackageApi.confirmWorkspacePackageImport(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            fileName = fileName,
            packageBytes = packageBytes,
            lastModifiedByReplicaId = lastModifiedByReplicaId,
            options = options
        )
    }

    override suspend fun loadProgressSummary(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ): CloudProgressSummary {
        return progressApi.loadProgressSummary(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            timeZone = timeZone
        )
    }

    override suspend fun loadProgressSeries(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String,
        from: String,
        to: String
    ): CloudProgressSeries {
        return progressApi.loadProgressSeries(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            timeZone = timeZone,
            from = from,
            to = to
        )
    }

    override suspend fun loadProgressReviewSchedule(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ): CloudProgressReviewSchedule {
        return progressApi.loadProgressReviewSchedule(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            timeZone = timeZone
        )
    }

    override suspend fun loadProgressLeaderboard(
        apiBaseUrl: String,
        authorizationHeader: String
    ): CloudProgressLeaderboard {
        return progressApi.loadProgressLeaderboard(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader
        )
    }

    override suspend fun loadProgressStreakLeaderboard(
        apiBaseUrl: String,
        authorizationHeader: String
    ): CloudProgressStreakLeaderboard {
        return progressApi.loadProgressStreakLeaderboard(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader
        )
    }

    override suspend fun loadProgressLeaderboardProfile(
        apiBaseUrl: String,
        authorizationHeader: String,
        publicProfileId: String
    ): CloudProgressLeaderboardProfile {
        return progressApi.loadProgressLeaderboardProfile(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            publicProfileId = publicProfileId
        )
    }

    override suspend fun loadCommunityProfile(
        apiBaseUrl: String,
        authorizationHeader: String
    ): CloudCommunityProfile {
        return communityProfileApi.loadCommunityProfile(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader
        )
    }

    override suspend fun updateCommunityLeaderboardParticipation(
        apiBaseUrl: String,
        authorizationHeader: String,
        leaderboardParticipationEnabled: Boolean
    ): CloudCommunityProfile {
        return communityProfileApi.updateCommunityLeaderboardParticipation(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            leaderboardParticipationEnabled = leaderboardParticipationEnabled
        )
    }

    override suspend fun createFriendInvitation(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: CloudFriendInvitationCreateRequest
    ): CloudFriendInvitationCreateResponse {
        return communityProfileApi.createFriendInvitation(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            request = request
        )
    }

    override suspend fun recordFeedbackPromptEvent(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: CloudFeedbackPromptEventRequest
    ): CloudFeedbackState {
        return feedbackApi.recordFeedbackPromptEvent(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            request = request
        )
    }

    override suspend fun submitFeedback(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: CloudFeedbackSubmissionRequest
    ): CloudFeedbackState {
        return feedbackApi.submitFeedback(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            request = request
        )
    }

    override suspend fun loadMediaAssetDownloadUrl(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        mediaAssetId: String
    ): MediaAssetDownloadUrl {
        return mediaAssetApi.loadMediaAssetDownloadUrl(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            mediaAssetId = mediaAssetId
        )
    }

    override suspend fun createMediaAssetUploadSession(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        request: MediaAssetUploadSessionCreateRequest
    ): MediaAssetUploadSessionCreateResponse {
        return mediaAssetApi.createMediaAssetUploadSession(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            request = request
        )
    }

    override suspend fun createMediaAssetUploadPartUrls(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        sessionId: String,
        request: MediaAssetUploadPartUrlsRequest
    ): MediaAssetUploadPartUrlsResponse {
        return mediaAssetApi.createMediaAssetUploadPartUrls(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            sessionId = sessionId,
            request = request
        )
    }

    override suspend fun completeMediaAssetUploadSession(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        sessionId: String,
        request: CompleteMediaAssetUploadSessionRequest
    ): MediaAssetUploadCompletion {
        return mediaAssetApi.completeMediaAssetUploadSession(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            sessionId = sessionId,
            request = request
        )
    }

    override suspend fun abortMediaAssetUploadSession(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        sessionId: String
    ): MediaAssetUploadSessionAbort {
        return mediaAssetApi.abortMediaAssetUploadSession(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            sessionId = sessionId
        )
    }

    override suspend fun deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String) {
        accountWorkspaceApi.deleteAccount(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            confirmationText = confirmationText
        )
    }

    override suspend fun listAgentConnections(
        apiBaseUrl: String,
        bearerToken: String
    ): AgentApiKeyConnectionsResult {
        return agentConnectionApi.listAgentConnections(apiBaseUrl = apiBaseUrl, bearerToken = bearerToken)
    }

    override suspend fun revokeAgentConnection(
        apiBaseUrl: String,
        bearerToken: String,
        connectionId: String
    ): AgentApiKeyConnectionsResult {
        return agentConnectionApi.revokeAgentConnection(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            connectionId = connectionId
        )
    }

    override suspend fun push(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemotePushResponse {
        return syncApi.push(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            body = body
        )
    }

    override suspend fun pull(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemotePullResponse {
        return syncApi.pull(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            body = body
        )
    }

    override suspend fun bootstrapPull(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPullResponse {
        return syncApi.bootstrapPull(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            body = body
        )
    }

    override suspend fun bootstrapPush(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPushResponse {
        return syncApi.bootstrapPush(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            body = body
        )
    }

    override suspend fun pullReviewHistory(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryPullResponse {
        return syncApi.pullReviewHistory(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            body = body
        )
    }

    override suspend fun importReviewHistory(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryImportResponse {
        return syncApi.importReviewHistory(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            body = body
        )
    }
}

private fun requireAuthHealthResponse(response: JSONObject) {
    if (response.optBoolean("ok", false)) {
        return
    }

    throw CloudHealthValidationException(
        message = "Cloud auth health response was not recognized.",
        cause = null
    )
}

private fun requireApiHealthResponse(response: JSONObject) {
    val status = response.optString("status", "").trim()
    if (status.equals("ok", ignoreCase = true)) {
        return
    }

    throw CloudHealthValidationException(
        message = "Cloud API health response was not recognized.",
        cause = null
    )
}
