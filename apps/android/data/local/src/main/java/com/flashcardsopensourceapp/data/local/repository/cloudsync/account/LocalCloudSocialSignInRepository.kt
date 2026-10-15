package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import android.util.Base64
import com.flashcardsopensourceapp.data.local.cloud.CloudAcceptedSocialSession
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudSocialAttemptBinding
import com.flashcardsopensourceapp.data.local.cloud.PendingCloudSocialSignIn
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.remote.auth.CloudSocialAuthGateway
import com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAuthMethods
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPendingSocialSignIn
import com.flashcardsopensourceapp.data.local.model.cloud.CloudProviderSignInHint
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialCredentialResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProviderAvailability
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.shouldRefreshCloudIdToken
import com.flashcardsopensourceapp.data.local.repository.CloudSocialSignInRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import java.security.MessageDigest
import java.security.SecureRandom
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

    override suspend fun beginGoogleLogin(rememberSignIn: Boolean): CloudPendingSocialSignIn {
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
                originalReauthenticationBinding = null,
                rememberSignIn = rememberSignIn,
                mailboxReason = null,
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
                attempt = pending.binding.attempt.attempt,
                codeVerifier = pending.binding.codeVerifier,
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

    override suspend fun requestMailboxCode(attempt: String, email: String) {
        operationCoordinator.runExclusive {
            val pending = requirePendingMailbox(attempt)
            socialGateway.requestSocialMailboxCode(
                authBaseUrl = pending.configuration.authBaseUrl,
                attempt = pending.binding.attempt.attempt,
                codeVerifier = pending.binding.codeVerifier,
                email = email
            )
        }
    }

    override suspend fun verifyMailboxCode(attempt: String, code: String): CloudPendingSocialSignIn {
        return operationCoordinator.runExclusive {
            val pending = requirePendingMailbox(attempt)
            val completion = socialGateway.verifySocialMailboxCode(
                authBaseUrl = pending.configuration.authBaseUrl,
                attempt = pending.binding.attempt.attempt,
                codeVerifier = pending.binding.codeVerifier,
                code = code
            )
            val updated = pending.copy(completion = completion)
            savePending(updated)
            updated.snapshot()
        }
    }

    override suspend fun prepareSignIn(attempt: String): CloudWorkspaceLinkContext = operationCoordinator.runExclusive {
        prepareAcceptedSession(pending = acceptSession(requirePending(attempt)))
    }

    override suspend fun completeSignIn(attempt: String, selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        return operationCoordinator.runExclusive {
            val context = prepareAcceptedSession(acceptSession(requirePending(attempt)))
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
                accountRepository.completeGuestUpgrade(linkContext = context, selection = selection)
            } else {
                accountRepository.completeSocialCloudLink(
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
            }
            withContext(NonCancellable + Dispatchers.IO) {
                // Re-read so an explicit forget cannot be undone by a resumed acceptance.
                val completed = requireNotNull(preferencesStore.socialAuthStore.loadPending()) {
                    "The completed social sign-in no longer has local attempt state."
                }
                check(completed.binding.attempt.attempt == attempt) { "The social sign-in attempt changed during completion." }
                val result = completed.copy(completedWorkspace = workspace)
                preferencesStore.socialAuthStore.savePending(result)
                preferencesStore.socialAuthStore.completeAcceptedSession(result)
            }
            workspace
        }
    }

    override suspend fun cancelSignIn(attempt: String) {
        operationCoordinator.runExclusive {
            withContext(Dispatchers.IO) {
                val pending = preferencesStore.socialAuthStore.loadPending() ?: return@withContext
                require(pending.binding.attempt.attempt == attempt) { "A different social sign-in attempt is active." }
                preferencesStore.socialAuthStore.clearPending()
            }
        }
    }

    override suspend fun rememberedSignIn(): CloudProviderSignInHint? = operationCoordinator.runExclusive {
        withContext(Dispatchers.IO) {
            preferencesStore.socialAuthStore.loadHint(preferencesStore.currentServerConfiguration())
        }
    }

    override suspend fun forgetRememberedSignIn() {
        operationCoordinator.runExclusive {
            withContext(Dispatchers.IO) { preferencesStore.socialAuthStore.forgetHint() }
        }
    }

    override suspend fun signOutAndForget() {
        operationCoordinator.runExclusive {
            accountRepository.logout()
        }
    }

    private suspend fun acceptSession(pending: PendingCloudSocialSignIn): PendingCloudSocialSignIn {
        pending.acceptedSession?.let { return pending }
        val completion = requireNotNull(pending.completion) { "The provider has not completed this sign-in attempt." }
        val session = socialGateway.redeemSocialLogin(
            authBaseUrl = pending.configuration.authBaseUrl,
            completion = completion.completion,
            codeVerifier = pending.binding.codeVerifier
        )
        require(session.signInHint.method == pending.provider) { "The accepted session belongs to a different sign-in method." }
        val accepted = pending.copy(acceptedSession = CloudAcceptedSocialSession(session.credentials, session.signInHint))
        // Retain the real session before any guest/workspace calls; redemption is single-use.
        withContext(NonCancellable + Dispatchers.IO) {
            preferencesStore.socialAuthStore.savePending(accepted)
        }
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
        require(pending.mailboxReason != null && pending.completion == null && pending.acceptedSession == null) {
            "This social sign-in is not waiting for mailbox verification."
        }
        return pending
    }

    private suspend fun requirePending(attempt: String): PendingCloudSocialSignIn {
        requireAccountIsNotDeleting()
        val pending = requireNotNull(withContext(Dispatchers.IO) { preferencesStore.socialAuthStore.loadPending() }) {
            "No social sign-in attempt is stored. Start sign-in again."
        }
        require(pending.binding.attempt.attempt == attempt) { "A different social sign-in attempt is active." }
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
                it.guestSession.userId == guest?.userId && it.guestSession.workspaceId == guest?.workspaceId &&
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

private fun PendingCloudSocialSignIn.isExpired(): Boolean {
    return acceptedSession == null &&
        (completion?.expiresAtMillis ?: binding.attempt.expiresAtMillis) <= System.currentTimeMillis()
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
