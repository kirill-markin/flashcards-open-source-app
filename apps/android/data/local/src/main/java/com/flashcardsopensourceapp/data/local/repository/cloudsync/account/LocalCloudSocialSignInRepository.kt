package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import android.util.Base64
import com.flashcardsopensourceapp.data.local.cloud.CloudAcceptedSocialSession
import com.flashcardsopensourceapp.data.local.cloud.CloudAppleBrowserBinding
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudSocialAttemptBinding
import com.flashcardsopensourceapp.data.local.cloud.PendingCloudSocialSignIn
import com.flashcardsopensourceapp.data.local.cloud.PendingCloudEmailSignIn
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.remote.auth.CloudSocialAuthGateway
import com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAppleBrowserLaunch
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAppleBrowserReturn
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAppleBrowserStatus
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAuthMethods
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEmailSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPendingSocialSignIn
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialCredentialResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProviderAvailability
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialSignInPhase
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSuccessfulSignInHint
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.cloudAppleReturnUri
import com.flashcardsopensourceapp.data.local.model.cloud.shouldRefreshCloudIdToken
import com.flashcardsopensourceapp.data.local.repository.CloudSocialSignInRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

class LocalCloudSocialSignInRepository(
    private val preferencesStore: CloudPreferencesStore,
    private val socialGateway: CloudSocialAuthGateway,
    private val remoteGateway: CloudRemoteGateway,
    private val accountRepository: LocalCloudAccountRepository,
    private val operationCoordinator: CloudOperationCoordinator
) : CloudSocialSignInRepository {
    override suspend fun loadAuthMethods(): CloudAuthMethods = operationCoordinator.runExclusive {
        socialGateway.loadAuthMethods(preferencesStore.currentServerConfiguration().authBaseUrl)
    }

    override suspend fun beginGoogleLogin(): CloudPendingSocialSignIn {
        return operationCoordinator.runExclusive {
            requireAccountIsNotDeleting()
            val configuration = preferencesStore.currentServerConfiguration()
            val methods = socialGateway.loadAuthMethods(configuration.authBaseUrl)
            require(methods.google is CloudSocialProviderAvailability.Native) {
                "Google native sign-in is unavailable on this server."
            }
            val verifier = newSocialCodeVerifier()
            val attempt = socialGateway.beginGoogleLogin(configuration.authBaseUrl, socialCodeChallenge(verifier))
            val origin = preferencesStore.currentCloudSettings()
            val pending = PendingCloudSocialSignIn(
                installationId = origin.installationId,
                linkedUserId = origin.linkedUserId,
                linkedWorkspaceId = origin.linkedWorkspaceId,
                activeWorkspaceId = origin.activeWorkspaceId,
                guestBinding = accountRepository.socialSignInGuestBinding(),
                acceptedUserId = null,
                configuration = configuration,
                provider = CloudSocialProvider.GOOGLE,
                binding = CloudSocialAttemptBinding(attempt = attempt, codeVerifier = verifier),
                appleBrowser = null,
                originalReauthenticationBinding = null,
                mailboxReason = null,
                mailboxCodeRequested = false,
                mailboxRequestInFlight = false,
                providerCredentialObserved = false,
                providerEmail = null,
                completion = null,
                acceptedSession = null,
                preparedContext = null,
                workspaceSelection = null,
                completedWorkspace = null,
                linkingWorkspace = null
            )
            savePending(pending)
            pending.snapshot()
        }
    }

    override suspend fun beginAppleLogin(): CloudAppleBrowserLaunch {
        return operationCoordinator.runExclusive {
            requireAccountIsNotDeleting()
            val configuration = preferencesStore.currentServerConfiguration()
            val method = socialGateway.loadAuthMethods(configuration.authBaseUrl).apple
            require(method is CloudSocialProviderAvailability.Browser &&
                method.nativeReturnUri == cloudAppleReturnUri && method.start == "/api/social/apple/start") {
                "Apple browser sign-in is unavailable on this server."
            }
            val origin = URI(configuration.authBaseUrl)
            require(origin.toString() in setOf("https://auth.nibomo.com", "https://auth.flashcards-open-source-app.com")) {
                "Apple sign-in requires a supported authentication origin."
            }
            val verifier = newSocialCodeVerifier()
            val localId = UUID.randomUUID().toString()
            val current = preferencesStore.currentCloudSettings()
            val pending = PendingCloudSocialSignIn(
                installationId = current.installationId,
                linkedUserId = current.linkedUserId,
                linkedWorkspaceId = current.linkedWorkspaceId,
                activeWorkspaceId = current.activeWorkspaceId,
                guestBinding = accountRepository.socialSignInGuestBinding(),
                acceptedUserId = null,
                configuration = configuration,
                provider = CloudSocialProvider.APPLE,
                binding = null,
                appleBrowser = CloudAppleBrowserBinding(localId, verifier, null),
                originalReauthenticationBinding = null,
                mailboxReason = null,
                mailboxCodeRequested = false,
                mailboxRequestInFlight = false,
                providerCredentialObserved = false,
                providerEmail = null,
                completion = null,
                acceptedSession = null,
                preparedContext = null,
                workspaceSelection = null,
                completedWorkspace = null,
                linkingWorkspace = null
            )
            savePending(pending)
            CloudAppleBrowserLaunch(localId, configuration.authBaseUrl + method.start +
                "?client=android&codeChallenge=" + socialCodeChallenge(verifier))
        }
    }

    override suspend fun canAcceptAppleBrowserReturn(returned: CloudAppleBrowserReturn): Boolean = operationCoordinator.runExclusive {
        val pending = withContext(Dispatchers.IO) { preferencesStore.socialAuthStore.loadPending() }
            ?: return@runExclusive false
        if (!pending.canAcceptAppleBrowserReturn(returned)) return@runExclusive false
        requireAccountIsNotDeleting()
        requireCurrentBinding(pending)
        !pending.isExpired()
    }

    override suspend fun acceptAppleBrowserReturn(returned: CloudAppleBrowserReturn): CloudPendingSocialSignIn? {
        return operationCoordinator.runExclusive {
            val pending = withContext(Dispatchers.IO) { preferencesStore.socialAuthStore.loadPending() }
                ?: return@runExclusive null
            if (!pending.canAcceptAppleBrowserReturn(returned)) return@runExclusive null
            val current = requirePending(pending.localId)
            val browser = requireNotNull(current.appleBrowser) { "This sign-in did not launch the Apple browser." }
            com.flashcardsopensourceapp.data.local.cloud.wire.validateSocialHandle(returned.handle)
            // A return has no local correlation ID; only the server can prove its PKCE binding.
            val updated = current.copy(appleBrowser = browser.copy(returned = returned))
            savePending(updated)
            updated.snapshot()
        }
    }

    override suspend fun verifyEmailCode(
        challenge: CloudOtpChallenge,
        code: String,
        onVerificationStarted: () -> Unit,
        onVerified: () -> Unit
    ): CloudWorkspaceLinkContext = operationCoordinator.runExclusive {
        requireAccountIsNotDeleting()
        val configuration = preferencesStore.currentServerConfiguration()
        var verified: CloudEmailSession? = null
        val context = accountRepository.verifyEmailCodeSession(challenge, code, onVerificationStarted) { session ->
            onVerified()
            verified = session
        }
        // The invalid-stored-state route returns a context without verifying a code; only a verified code stages.
        val session = verified ?: return@runExclusive context
        withContext(NonCancellable + Dispatchers.IO) {
            preferencesStore.socialAuthStore.stageEmailSession(PendingCloudEmailSignIn(configuration, context.userId, session.signInHint))
        }
        context
    }

    override suspend fun completeEmailSignInHint(context: CloudWorkspaceLinkContext) {
        operationCoordinator.runExclusive {
            check(preferencesStore.currentCloudSettings().linkedUserId == context.userId) {
                "Remembering email sign-in requires the completed cloud account."
            }
            withContext(Dispatchers.IO) {
                preferencesStore.socialAuthStore.completeEmailSession(
                    preferencesStore.currentServerConfiguration(), context.userId
                )
            }
        }
    }

    override suspend fun resumePendingSignIn(): CloudPendingSocialSignIn? = operationCoordinator.runExclusive {
        val pending = withContext(Dispatchers.IO) { preferencesStore.socialAuthStore.loadPending() }
            ?: return@runExclusive null
        requireCurrentBinding(pending)
        if (pending.isExpired()) {
            withContext(Dispatchers.IO) { preferencesStore.socialAuthStore.clearPending() }
            return@runExclusive null
        }
        pending.snapshot()
    }

    override suspend fun submitGoogleCredential(attempt: String, identityToken: String): CloudPendingSocialSignIn {
        return operationCoordinator.runExclusive {
            val pending = requirePending(attempt)
            require(pending.provider == CloudSocialProvider.GOOGLE && pending.completion == null && pending.acceptedSession == null) {
                "Google credential submission requires an unfinished Google attempt."
            }
            val result = socialGateway.submitGoogleCredential(
                authBaseUrl = pending.configuration.authBaseUrl,
                attempt = pending.serverAttempt,
                codeVerifier = pending.codeVerifier,
                identityToken = identityToken
            )
            val updated = when (result) {
                is CloudSocialCredentialResult.Completed -> pending.copy(completion = result.result)
                is CloudSocialCredentialResult.VerificationRequired -> pending.copy(
                    mailboxReason = result.reason,
                    providerEmail = result.providerEmail
                )
            }
            savePending(updated)
            updated.snapshot()
        }
    }

    override suspend fun requestMailboxCode(attempt: String, email: String, onRequested: () -> Unit, onCredentialReceived: () -> Unit) {
        operationCoordinator.runExclusive {
            val pending = requirePendingMailbox(attempt)
            check(!pending.mailboxCodeRequested) { "A code was already requested. Start a fresh sign-in for another code." }
            savePending(pending.copy(mailboxRequestInFlight = true))
            socialGateway.requestSocialMailboxCode(
                authBaseUrl = pending.configuration.authBaseUrl,
                attempt = pending.serverAttempt,
                codeVerifier = pending.codeVerifier,
                email = email
            )
            onRequested()
            if (pending.provider == CloudSocialProvider.APPLE && !pending.providerCredentialObserved) onCredentialReceived()
            savePending(pending.copy(mailboxCodeRequested = true, mailboxRequestInFlight = false,
                providerCredentialObserved = true))
        }
    }

    override suspend fun verifyMailboxCode(attempt: String, code: String, onVerificationStarted: () -> Unit, onVerified: () -> Unit): CloudPendingSocialSignIn {
        return operationCoordinator.runExclusive {
            val pending = requirePendingMailbox(attempt)
            check(pending.mailboxCodeRequested) { "Request a code before verifying it." }
            savePending(pending.copy(mailboxRequestInFlight = true))
            onVerificationStarted()
            val completion = socialGateway.verifySocialMailboxCode(
                authBaseUrl = pending.configuration.authBaseUrl,
                attempt = pending.serverAttempt,
                codeVerifier = pending.codeVerifier,
                code = code
            )
            onVerified()
            val updated = pending.copy(completion = completion, mailboxRequestInFlight = false)
            savePending(updated)
            updated.snapshot()
        }
    }

    override suspend fun prepareSignIn(attempt: String, onCredentialReceived: () -> Unit, onSessionAccepted: () -> Unit): CloudWorkspaceLinkContext = operationCoordinator.runExclusive {
        val pending = requirePending(attempt)
        prepareAcceptedSession(pending = acceptSession(pending, onCredentialReceived, onSessionAccepted))
    }

    override suspend fun completeSignIn(attempt: String, selection: CloudWorkspaceLinkSelection, onGuestCompletionStarted: () -> Unit, onGuestCompletionFinished: () -> Unit): CloudWorkspaceSummary {
        return operationCoordinator.runExclusive {
            val context = prepareAcceptedSession(requirePending(attempt))
            val pending = requirePending(attempt)
            require(pending.workspaceSelection == null || pending.workspaceSelection == selection) {
                "This sign-in already started completing a different workspace selection. Retry the original selection."
            }
            savePending(pending.copy(workspaceSelection = selection))
            val workspace = if (pending.completedWorkspace != null &&
                withContext(Dispatchers.IO) { preferencesStore.loadPendingGuestUpgrade() } == null
            ) {
                pending.completedWorkspace
            } else if (context.guestUpgradeMode == CloudGuestUpgradeMode.MERGE_REQUIRED) {
                accountRepository.completeGuestUpgrade(
                    linkContext = context, selection = selection,
                    onGuestCompletionStarted = onGuestCompletionStarted,
                    onGuestCompletionFinished = onGuestCompletionFinished
                )
            } else {
                val linked = accountRepository.completeSocialCloudLink(
                    linkContext = context,
                    selection = selection,
                    retainedWorkspace = pending.linkingWorkspace,
                    onWorkspaceSelected = { selectedWorkspace ->
                        withContext(NonCancellable + Dispatchers.IO) {
                            val completing = requirePending(attempt)
                            check(completing.linkingWorkspace == null ||
                                completing.linkingWorkspace.workspaceId == selectedWorkspace.workspaceId) {
                                "The social sign-in completion workspace changed. Start sign-in again."
                            }
                            preferencesStore.socialAuthStore.savePending(
                                completing.copy(linkingWorkspace = selectedWorkspace)
                            )
                        }
                    }
                )
                linked
            }
            withContext(NonCancellable + Dispatchers.IO) {
                val completed = requireNotNull(preferencesStore.socialAuthStore.loadPending()) {
                    "The completed social sign-in no longer has local attempt state."
                }
                check(completed.localId == attempt) { "The social sign-in attempt changed during completion." }
                val result = completed.copy(completedWorkspace = workspace)
                preferencesStore.socialAuthStore.savePending(result)
            }
            workspace
        }
    }

    override suspend fun completeSignInHint(attempt: String) {
        operationCoordinator.runExclusive {
            val pending = requirePending(attempt)
            check(pending.completedWorkspace != null) { "Remembering sign-in requires the completed workspace." }
            withContext(NonCancellable + Dispatchers.IO) {
                val accepted = requireNotNull(pending.acceptedSession)
                val settings = preferencesStore.currentCloudSettings()
                val suggestion = accepted.connectionSuggestion?.takeIf { it.expiresAtMillis > System.currentTimeMillis() }
                val connection = suggestion?.let {
                    com.flashcardsopensourceapp.data.local.cloud.PendingCloudAccountMethod(
                        UUID.randomUUID().toString(), preferencesStore.accountMethodStore.epoch(), settings.installationId,
                        requireNotNull(settings.linkedUserId), settings.linkedWorkspaceId, settings.activeWorkspaceId,
                        pending.configuration, if (pending.provider == CloudSocialProvider.GOOGLE)
                            com.flashcardsopensourceapp.data.local.model.cloud.CloudSignInMethod.GOOGLE
                            else com.flashcardsopensourceapp.data.local.model.cloud.CloudSignInMethod.APPLE,
                        com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodIntent.CONNECT,
                        com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodPhase.CONNECTION_SUGGESTED,
                        pending.codeVerifier, null, null, null, null, null, null, null, false, null,
                        com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountConnection(
                            null, it.expiresAtMillis, false, null, null, it))
                }
                preferencesStore.socialAuthStore.completeAcceptedSession(pending, connection)
            }
        }
    }

    override suspend fun cancelSignIn(attempt: String) {
        operationCoordinator.runExclusive {
            withContext(Dispatchers.IO) {
                val pending = preferencesStore.socialAuthStore.loadPending() ?: return@withContext
                require(pending.localId == attempt) { "A different social sign-in attempt is active." }
                preferencesStore.socialAuthStore.clearPending()
            }
        }
    }

    override suspend fun rememberedSignIn(): CloudSuccessfulSignInHint? = operationCoordinator.runExclusive {
        withContext(Dispatchers.IO) {
            preferencesStore.socialAuthStore.loadHint(preferencesStore.currentServerConfiguration())
        }
    }

    private suspend fun acceptSession(pending: PendingCloudSocialSignIn, onCredentialReceived: () -> Unit, onSessionAccepted: () -> Unit): PendingCloudSocialSignIn {
        pending.acceptedSession?.let { return pending }
        val completion = requireNotNull(pending.completionHandle) { "The provider has not completed this sign-in attempt." }
        val session = socialGateway.redeemSocialLogin(
            authBaseUrl = pending.configuration.authBaseUrl,
            completion = completion,
            codeVerifier = pending.codeVerifier
        )
        require(session.signInHint.method == pending.provider) { "The accepted session belongs to a different sign-in method." }
        if (pending.provider == CloudSocialProvider.APPLE && !pending.providerCredentialObserved) onCredentialReceived()
        val accepted = pending.copy(acceptedSession = CloudAcceptedSocialSession(session.credentials, session.signInHint, session.connectionSuggestion),
            providerCredentialObserved = true)
        // Retain the real session before any guest/workspace calls; redemption is single-use.
        withContext(NonCancellable + Dispatchers.IO) {
            preferencesStore.socialAuthStore.savePending(accepted)
        }
        onSessionAccepted()
        return accepted
    }

    private suspend fun prepareAcceptedSession(pending: PendingCloudSocialSignIn): CloudWorkspaceLinkContext {
        var accepted = requireNotNull(pending.acceptedSession) { "A redeemed Nibomo session is required." }
        if (shouldRefreshCloudIdToken(accepted.credentials.idTokenExpiresAtMillis, System.currentTimeMillis())) {
            accepted = accepted.copy(credentials = remoteGateway.refreshIdToken(
                refreshToken = accepted.credentials.refreshToken,
                authBaseUrl = pending.configuration.authBaseUrl
            ))
            savePending(pending.copy(acceptedSession = accepted))
        }
        val context = pending.preparedContext?.copy(credentials = accepted.credentials)
            ?: accountRepository.prepareSocialSignIn(credentials = accepted.credentials)
        check(pending.acceptedUserId == null || pending.acceptedUserId == context.userId) {
            "The accepted cloud account changed during sign-in. Start sign-in again."
        }
        savePending(pending.copy(
            acceptedUserId = context.userId,
            acceptedSession = accepted,
            preparedContext = context
        ))
        return context
    }

    private suspend fun requirePendingMailbox(attempt: String): PendingCloudSocialSignIn {
        val pending = requirePending(attempt)
        require(pending.snapshot().phase == CloudSocialSignInPhase.MAILBOX) {
            "This social sign-in is not waiting for mailbox verification."
        }
        return pending
    }

    private suspend fun requirePending(attempt: String): PendingCloudSocialSignIn {
        requireAccountIsNotDeleting()
        val pending = requireNotNull(withContext(Dispatchers.IO) { preferencesStore.socialAuthStore.loadPending() }) {
            "No social sign-in attempt is stored. Start sign-in again."
        }
        require(pending.localId == attempt) { "A different social sign-in attempt is active." }
        requireCurrentBinding(pending)
        check(pending.isExpired().not()) { "The social sign-in attempt expired. Start sign-in again." }
        return pending
    }

    private fun requireCurrentBinding(pending: PendingCloudSocialSignIn) {
        val current = preferencesStore.currentCloudSettings()
        val guest = pending.guestBinding
        val isOrigin = current.linkedUserId == pending.linkedUserId &&
            current.linkedWorkspaceId == pending.linkedWorkspaceId && current.activeWorkspaceId == pending.activeWorkspaceId
        val isOwnGuestPreparation = pending.acceptedSession != null && guest != null &&
            current.cloudState == CloudAccountState.GUEST && current.linkedUserId == null &&
            current.linkedWorkspaceId == null && current.activeWorkspaceId == guest.workspaceId
        val isRestoredGuest = guest != null && current.cloudState == CloudAccountState.GUEST &&
            current.linkedUserId == guest.userId && current.linkedWorkspaceId == guest.workspaceId &&
            current.activeWorkspaceId == guest.workspaceId
        val upgrade = preferencesStore.loadPendingGuestUpgrade()
        val upgradeWorkspace = upgrade?.takeIf {
            it.configuration == pending.configuration && it.accountSnapshot.userId == pending.acceptedUserId &&
                it.guestSession.userId == guest?.userId && it.guestSession.workspaceId == guest.workspaceId &&
                it.selection == pending.workspaceSelection && it.guestUpgradeMode == pending.preparedContext?.guestUpgradeMode
        }?.completion?.workspace
        val completedWorkspace = pending.completedWorkspace ?: pending.linkingWorkspace ?: upgradeWorkspace
        val isOwnAcceptedIdentity = pending.acceptedUserId != null && completedWorkspace != null &&
            current.cloudState == CloudAccountState.LINKED && current.linkedUserId == pending.acceptedUserId &&
            current.linkedWorkspaceId == completedWorkspace.workspaceId && current.activeWorkspaceId == completedWorkspace.workspaceId
        require(pending.installationId == current.installationId &&
            (isOrigin || isOwnGuestPreparation || isRestoredGuest || isOwnAcceptedIdentity) &&
            pending.configuration == preferencesStore.currentServerConfiguration()) {
            "The local account, workspace or server changed. Start sign-in again."
        }
        require(pending.originalReauthenticationBinding == null) { "Account-management proof cannot be accepted as a login." }
    }

    private fun requireAccountIsNotDeleting() {
        check(preferencesStore.currentAccountDeletionState() == AccountDeletionState.Hidden) {
            "Finish account deletion before starting a social sign-in."
        }
    }

    private suspend fun savePending(pending: PendingCloudSocialSignIn) {
        withContext(Dispatchers.IO) { preferencesStore.socialAuthStore.savePending(pending) }
    }
}

private fun PendingCloudSocialSignIn.canAcceptAppleBrowserReturn(returned: CloudAppleBrowserReturn): Boolean {
    return appleBrowser != null && provider == CloudSocialProvider.APPLE && binding == null &&
        originalReauthenticationBinding == null && acceptedSession == null && completion == null &&
        returned.status != CloudAppleBrowserStatus.PROVIDER_PROVED
}

private fun PendingCloudSocialSignIn.isExpired(): Boolean {
    return acceptedSession == null &&
        (completion?.expiresAtMillis ?: binding?.attempt?.expiresAtMillis)?.let { it <= System.currentTimeMillis() } == true
}

private fun newSocialCodeVerifier(): String {
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}

private fun socialCodeChallenge(verifier: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))
    return Base64.encodeToString(digest, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}
