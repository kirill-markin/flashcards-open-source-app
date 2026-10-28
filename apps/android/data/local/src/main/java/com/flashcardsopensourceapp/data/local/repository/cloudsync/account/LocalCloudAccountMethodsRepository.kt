package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountConnection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudConnectionAction
import com.flashcardsopensourceapp.data.local.model.cloud.CloudConnectionResponse
import android.util.Base64
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.PendingCloudAccountMethod
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.remote.auth.CloudAccountMethodSession
import com.flashcardsopensourceapp.data.local.cloud.remote.auth.CloudAccountMethodsGateway
import com.flashcardsopensourceapp.data.local.cloud.remote.auth.CloudSocialAuthGateway
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethods
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountProviderMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSignInMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPendingAccountMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodPhase
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodIntent
import com.flashcardsopensourceapp.data.local.model.cloud.CloudProviderMethodTarget
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodLaunch
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAppleBrowserReturn
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAppleBrowserStatus
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProviderAvailability
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodReceipt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodProof
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState
import com.flashcardsopensourceapp.data.local.repository.CloudAccountMethodsRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.AuthenticatedCloudSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

class LocalCloudAccountMethodsRepository(
    private val preferencesStore: CloudPreferencesStore,
    private val gateway: CloudAccountMethodsGateway,
    private val socialGateway: CloudSocialAuthGateway,
    remoteGateway: CloudRemoteGateway,
    private val operationCoordinator: CloudOperationCoordinator,
    resetCoordinator: CloudIdentityResetCoordinator,
    private val accountRepository: LocalCloudAccountRepository
) : CloudAccountMethodsRepository {
    private val sessionProvider = CloudSessionProvider(preferencesStore, remoteGateway, operationCoordinator, resetCoordinator)

    override suspend fun loadMethods(): CloudAccountMethods = operationCoordinator.runExclusive {
        val session = currentSession()
        val origin = newPending(session, CloudSignInMethod.EMAIL, preferencesStore.accountMethodStore.epoch())
        val methods = gateway.loadAccountMethods(session.transport())
        requireContext(origin)
        methods
    }

    override suspend fun resume(): CloudPendingAccountMethod? = operationCoordinator.runExclusive {
        val pending = load() ?: return@runExclusive null
        requireContext(pending)
        val expiry = pending.snapshot().expiresAtMillis
        if (expiry > 0 && expiry <= System.currentTimeMillis() && pending.phase !in setOf(
            CloudAccountMethodPhase.MUTATED, CloudAccountMethodPhase.CONNECTION_CONFIRMING, CloudAccountMethodPhase.CONNECTED)) {
            update(pending, pending.copy(phase = CloudAccountMethodPhase.RESTART_REQUIRED))
        } else pending.snapshot()
    }

    override suspend fun beginReauthentication(method: CloudSignInMethod, onEmailCodeRequestStarted: () -> Unit,
        onEmailCodeRequested: () -> Unit): CloudPendingAccountMethod = operationCoordinator.runExclusive {
        val epoch = withContext(Dispatchers.IO) { preferencesStore.accountMethodStore.epoch() }
        val previous = load()
        val session = currentSession()
        val pending = newPending(session, method, epoch)
        save(previous, pending)
        if (method == CloudSignInMethod.EMAIL) {
            val transport = session.transport()
            val codeChallenge = challenge(pending.verifier)
            onEmailCodeRequestStarted()
            val attempt = gateway.beginEmailReauthentication(transport, codeChallenge)
            onEmailCodeRequested()
            update(pending, pending.copy(attempt = attempt, phase = CloudAccountMethodPhase.EMAIL_CODE))
        } else beginProvider(pending, session) {}
    }

    override suspend fun beginConnection(localId: String): CloudPendingAccountMethod = operationCoordinator.runExclusive {
        val pending = requireProof(localId)
        val session = sessionFor(pending)
        requireConnectionCapability(pending)
        val submitting = pending.copy(intent = CloudAccountMethodIntent.CONNECT, phase = CloudAccountMethodPhase.SUBMITTING)
        save(pending, submitting)
        receiveConnection(submitting, gateway.accountConnection(session.transport(), pending.verifier,
            CloudConnectionAction.Begin(requireNotNull(pending.originalProof).receipt.completion)))
    }

    override suspend fun adoptConnection(localId: String): CloudPendingAccountMethod = operationCoordinator.runExclusive {
        val pending = requirePending(localId)
        require(pending.phase == CloudAccountMethodPhase.CONNECTION_SUGGESTED)
        val session = sessionFor(pending)
        requireConnectionCapability(pending)
        val submitting = checkpoint(pending)
        receiveConnection(submitting, gateway.accountConnection(session.transport(), pending.verifier,
            CloudConnectionAction.Adopt(requireNotNull(pending.connection?.suggestion).suggestion)))
    }

    override suspend fun beginConnectionProvider(localId: String, provider: CloudSocialProvider): CloudPendingAccountMethod = operationCoordinator.runExclusive {
        val pending = requireConnection(localId)
        require(pending.phase == CloudAccountMethodPhase.CONNECTION_TARGET)
        val session = sessionFor(pending)
        val methods = socialGateway.loadAuthMethods(pending.configuration.authBaseUrl)
        requireRetained(pending)
        val availability = if (provider == CloudSocialProvider.GOOGLE) methods.google else methods.apple
        require(if (provider == CloudSocialProvider.GOOGLE) availability is CloudSocialProviderAvailability.Native
            else availability is CloudSocialProviderAvailability.Browser)
        val submitting = pending.copy(method = provider.method(), phase = CloudAccountMethodPhase.SUBMITTING,
            googleAudience = (availability as? CloudSocialProviderAvailability.Native)?.audience,
            mailboxEmail = null, mailboxCodeRequested = false)
        save(pending, submitting)
        receiveConnection(submitting, gateway.accountConnection(session.transport(), pending.verifier,
            CloudConnectionAction.ProviderBegin(requireNotNull(pending.connection?.operation), provider, challenge(pending.verifier))))
    }

    override suspend fun sendConnectionEmail(localId: String, email: String): CloudPendingAccountMethod = operationCoordinator.runExclusive {
        val pending = requireConnection(localId)
        require(pending.phase == CloudAccountMethodPhase.CONNECTION_TARGET)
        val session = sessionFor(pending)
        val submitting = checkpoint(pending)
        receiveConnection(submitting, gateway.accountConnection(session.transport(), pending.verifier,
            CloudConnectionAction.EmailSend(requireNotNull(pending.connection?.operation), email.trim().lowercase(java.util.Locale.ROOT))))
    }

    override suspend fun previewConnection(localId: String, omittedWorkspaceIds: List<String>): CloudPendingAccountMethod = operationCoordinator.runExclusive {
        val pending = requireConnection(localId)
        require(pending.connection?.proved == true && pending.phase in setOf(
            CloudAccountMethodPhase.CONNECTION_TARGET, CloudAccountMethodPhase.CONNECTION_PREVIEW))
        require(preferencesStore.currentCloudSettings().activeWorkspaceId !in omittedWorkspaceIds) {
            "The current offline workspace must be retained."
        }
        val session = sessionFor(pending)
        val submitting = checkpoint(pending)
        receiveConnection(submitting, gateway.accountConnection(session.transport(), pending.verifier,
            CloudConnectionAction.Preview(requireNotNull(pending.connection.operation), omittedWorkspaceIds)))
    }

    override suspend fun confirmConnection(localId: String): CloudPendingAccountMethod = operationCoordinator.runExclusive {
        val pending = requireConnection(localId)
        require(pending.phase in setOf(CloudAccountMethodPhase.CONNECTION_PREVIEW, CloudAccountMethodPhase.CONNECTION_CONFIRMING))
        val session = sessionFor(pending)
        val preview = requireNotNull(pending.connection?.preview)
        val submitting = pending.copy(phase = CloudAccountMethodPhase.CONNECTION_CONFIRMING)
        save(pending, submitting)
        try {
            receiveConnection(submitting, gateway.accountConnection(session.transport(), pending.verifier,
                CloudConnectionAction.Confirm(requireNotNull(pending.connection.operation), preview)))
        } catch (error: com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException) {
            if (error.errorCode == "ACCOUNT_CONNECTION_PREVIEW_CHANGED") {
                save(submitting, submitting.copy(phase = CloudAccountMethodPhase.CONNECTION_TARGET,
                    connection = requireNotNull(submitting.connection).copy(preview = null)))
            }
            throw error
        }
    }

    override suspend fun loadConnection(localId: String): CloudPendingAccountMethod = operationCoordinator.runExclusive {
        val pending = requireConnection(localId)
        require(pending.phase != CloudAccountMethodPhase.CONNECTION_CONFIRMING) {
            "Keep the exact confirmation for an explicit replay."
        }
        val session = sessionFor(pending)
        receiveConnection(pending, gateway.accountConnection(session.transport(), pending.verifier,
            CloudConnectionAction.Load(requireNotNull(pending.connection?.operation))))
    }

    private suspend fun requireConnectionCapability(pending: PendingCloudAccountMethod) {
        check(socialGateway.loadAuthMethods(pending.configuration.authBaseUrl).account.connectionSupported) {
            "Account connection is not available on this server."
        }
        requireRetained(pending)
    }

    private suspend fun requireConnection(localId: String): PendingCloudAccountMethod =
        requirePending(localId).also { require(it.intent == CloudAccountMethodIntent.CONNECT && it.connection?.operation != null) }

    private suspend fun receiveConnection(pending: PendingCloudAccountMethod, response: CloudConnectionResponse): CloudPendingAccountMethod {
        val prior = pending.connection
        val updated = when (response) {
            is CloudConnectionResponse.Receipt -> pending.copy(phase = CloudAccountMethodPhase.CONNECTION_TARGET,
                connection = CloudAccountConnection(response.operation, response.expiresAtMillis, response.proved, null, null, null),
                attempt = null, mailboxEmail = null, mailboxCodeRequested = false)
            is CloudConnectionResponse.Provider -> pending.copy(phase = CloudAccountMethodPhase.PROVIDER, attempt = response.proof)
            is CloudConnectionResponse.Email -> pending.copy(method = CloudSignInMethod.EMAIL, phase = CloudAccountMethodPhase.EMAIL_CODE,
                mailboxEmail = response.email, mailboxCodeRequested = true,
                connection = requireNotNull(prior).copy(expiresAtMillis = response.expiresAtMillis))
            is CloudConnectionResponse.Preview -> {
                check(prior?.operation == response.operation)
                pending.copy(phase = CloudAccountMethodPhase.CONNECTION_PREVIEW, connection = requireNotNull(prior).copy(preview = response.choices))
            }
            is CloudConnectionResponse.Connected -> return withContext(NonCancellable) {
                check(response.result.operationId == prior?.preview?.operationId)
                val committed = pending.copy(connection = requireNotNull(prior).copy(committed = response.result))
                save(pending, committed)
                accountRepository.reconcileConnectedAccount(response.result)
                val current = preferencesStore.currentCloudSettings()
                val reconciled = committed.copy(phase = CloudAccountMethodPhase.CONNECTED,
                    workspaceId = current.linkedWorkspaceId, activeWorkspaceId = current.activeWorkspaceId)
                save(committed, reconciled)
                reconciled.snapshot()
            }
            is CloudConnectionResponse.AlreadyConnected -> pending.copy(phase = CloudAccountMethodPhase.ALREADY_CONNECTED,
                connection = CloudAccountConnection(response.operation, prior?.expiresAtMillis ?: 0L, false, null, null, null))
            is CloudConnectionResponse.Cancelled -> pending.copy(phase = CloudAccountMethodPhase.RESTART_REQUIRED)
        }
        return update(pending, updated)
    }

    override suspend fun beginLink(localId: String, provider: CloudSocialProvider,
        onCurrentAccountProofConfirmed: () -> Unit): CloudPendingAccountMethod = operationCoordinator.runExclusive {
        val pending = requireProof(localId)
        val session = sessionFor(pending)
        val next = pending.copy(localId = UUID.randomUUID().toString(), method = provider.method(), intent = CloudAccountMethodIntent.LINK,
            verifier = verifier(), attempt = null, phase = CloudAccountMethodPhase.SUBMITTING,
            linkReceipt = null, googleAudience = null, mailboxReason = null, providerEmail = null, mailboxEmail = null,
            mailboxCodeRequested = false, target = null)
        save(pending, next)
        beginProvider(next, session, onCurrentAccountProofConfirmed)
    }

    override suspend fun beginReenable(localId: String, target: CloudProviderMethodTarget,
        onCurrentAccountProofConfirmed: () -> Unit): CloudPendingAccountMethod = operationCoordinator.runExclusive {
        val pending = requireProof(localId)
        val session = sessionFor(pending)
        require(!loadCurrentTarget(pending, session, target).active) { "Only a currently disabled method can be explicitly re-enabled." }
        val next = pending.copy(localId = UUID.randomUUID().toString(), method = target.provider.method(), intent = CloudAccountMethodIntent.REENABLE,
            verifier = verifier(), attempt = null, phase = CloudAccountMethodPhase.SUBMITTING,
            linkReceipt = null, googleAudience = null, mailboxReason = null, providerEmail = null, mailboxEmail = null,
            mailboxCodeRequested = false, target = target)
        save(pending, next)
        beginProvider(next, session, onCurrentAccountProofConfirmed)
    }

    override suspend fun prepareProviderLaunch(localId: String): CloudAccountMethodLaunch = operationCoordinator.runExclusive {
        val pending = requirePending(localId)
        require(pending.phase == CloudAccountMethodPhase.PROVIDER) { "This provider attempt was already submitted. Start fresh verification." }
        requireNotNull(pending.snapshot().launch)
    }

    override suspend fun submitGoogleCredential(localId: String, identityToken: String, onProviderReturned: () -> Unit,
        onMutationConfirmed: () -> Unit): CloudPendingAccountMethod = operationCoordinator.runExclusive {
        val pending = requirePending(localId)
        require(pending.method == CloudSignInMethod.GOOGLE && pending.phase == CloudAccountMethodPhase.PROVIDER) {
            "Google proof requires its current unsubmitted native attempt."
        }
        val session = sessionFor(pending)
        onProviderReturned()
        val submitting = checkpoint(pending)
        if (pending.intent == CloudAccountMethodIntent.CONNECT) return@runExclusive receiveConnection(submitting,
            gateway.accountConnection(session.transport(), pending.verifier, CloudConnectionAction.GoogleComplete(
                requireNotNull(pending.connection?.operation), requireNotNull(pending.attempt).attempt, identityToken)))
        val result = gateway.submitAccountGoogle(session.transport(), pending.intent, requireNotNull(pending.attempt).attempt,
            pending.verifier, identityToken)
        if (result == CloudAccountMethodResult.Mutated) onMutationConfirmed()
        update(submitting, when (result) {
            is CloudAccountMethodResult.Completed -> withReceipt(submitting, result.receipt)
            is CloudAccountMethodResult.Mailbox -> submitting.copy(phase = CloudAccountMethodPhase.MAILBOX,
                mailboxReason = result.reason, providerEmail = result.providerEmail)
            CloudAccountMethodResult.Mutated -> submitting.copy(phase = CloudAccountMethodPhase.MUTATED)
        })
    }

    override suspend fun requestMailboxCode(localId: String, email: String, onRequested: () -> Unit): CloudPendingAccountMethod = operationCoordinator.runExclusive {
        val pending = requirePending(localId)
        require(pending.phase == CloudAccountMethodPhase.MAILBOX && !pending.mailboxCodeRequested) {
            "A mailbox code cannot be sent again. Start fresh verification."
        }
        val session = sessionFor(pending)
        val mailboxEmail = email.trim().lowercase(java.util.Locale.ROOT)
        val submitting = checkpoint(pending)
        gateway.sendAccountMailbox(session.transport(), pending.purpose, requireNotNull(pending.attempt).attempt, pending.verifier, mailboxEmail)
        onRequested()
        update(submitting, submitting.copy(phase = CloudAccountMethodPhase.MAILBOX, mailboxCodeRequested = true, mailboxEmail = mailboxEmail))
    }

    override suspend fun verifyCode(localId: String, code: String, onProofConfirmed: () -> Unit): CloudPendingAccountMethod = operationCoordinator.runExclusive {
        val pending = requirePending(localId)
        require(pending.phase == CloudAccountMethodPhase.EMAIL_CODE ||
            (pending.phase == CloudAccountMethodPhase.MAILBOX && pending.mailboxCodeRequested)) {
            "This account proof is not awaiting an unused verification code."
        }
        val session = sessionFor(pending)
        val submitting = checkpoint(pending)
        if (pending.intent == CloudAccountMethodIntent.CONNECT) {
            val response = gateway.accountConnection(session.transport(), pending.verifier, CloudConnectionAction.EmailVerify(
                requireNotNull(pending.connection?.operation), code))
            onProofConfirmed()
            return@runExclusive receiveConnection(submitting, response)
        }
        val receipt = if (pending.method == CloudSignInMethod.EMAIL) {
            gateway.completeEmailReauthentication(session.transport(), requireNotNull(pending.attempt).attempt, pending.verifier, code)
        } else gateway.verifyAccountMailbox(session.transport(), pending.purpose, requireNotNull(pending.attempt).attempt, pending.verifier, code)
        onProofConfirmed()
        update(submitting, withReceipt(submitting, receipt))
    }

    override suspend fun hasPendingManagementPurpose(): Boolean = operationCoordinator.runExclusive {
        // Select the protected purpose before interpreting any untrusted callback fields.
        load() != null
    }

    override suspend fun acceptAppleReturn(returned: CloudAppleBrowserReturn): CloudPendingAccountMethod = operationCoordinator.runExclusive {
        val pending = requireNotNull(load()) { "No protected account-management browser launch exists." }
        requireContext(pending)
        require(pending.method == CloudSignInMethod.APPLE && pending.attempt?.browserStart != null &&
            pending.phase in setOf(CloudAccountMethodPhase.PROVIDER, CloudAccountMethodPhase.MAILBOX,
                CloudAccountMethodPhase.PROOF_READY, CloudAccountMethodPhase.LINK_READY, CloudAccountMethodPhase.APPLE_PROVED) &&
            !pending.mailboxCodeRequested) { "This account-management browser attempt cannot accept another return. Start fresh verification." }
        requireNotExpired(pending)
        val attempt = requireNotNull(pending.attempt)
        if (pending.intent == CloudAccountMethodIntent.CONNECT) {
            require(returned.handle == attempt.attempt && returned.status in setOf(
                CloudAppleBrowserStatus.PROVIDER_PROVED, CloudAppleBrowserStatus.DENIED)) {
                "Apple return does not match its protected account connection."
            }
            if (returned.status == CloudAppleBrowserStatus.DENIED)
                return@runExclusive update(pending, pending.copy(phase = CloudAccountMethodPhase.DENIED))
            // The browser return is only a candidate; the ViewModel loads server proof with the retained verifier.
            return@runExclusive pending.snapshot()
        }
        val updated = when (returned.status) {
            CloudAppleBrowserStatus.COMPLETED -> {
                require(pending.intent != CloudAccountMethodIntent.REENABLE) { "Apple re-enable requires its original proved attempt." }
                // A callback is only a candidate. The server proves the receipt against app-held PKCE.
                withReceipt(pending, CloudAccountMethodReceipt(returned.handle,
                    minOf(attempt.expiresAtMillis, System.currentTimeMillis() + 120_000L)))
            }
            CloudAppleBrowserStatus.VERIFICATION_REQUIRED -> {
                require(returned.handle == attempt.attempt && pending.intent != CloudAccountMethodIntent.REENABLE) {
                    "The mailbox return does not match the protected account proof."
                }
                pending.copy(phase = CloudAccountMethodPhase.MAILBOX, originalProof = pending.originalProof,
                    linkReceipt = null, mailboxReason = null, providerEmail = null)
            }
            CloudAppleBrowserStatus.PROVIDER_PROVED -> {
                require(pending.intent == CloudAccountMethodIntent.REENABLE && returned.handle == attempt.attempt) {
                    "Apple re-enable return does not match its original protected attempt."
                }
                pending.copy(phase = CloudAccountMethodPhase.APPLE_PROVED)
            }
            CloudAppleBrowserStatus.DENIED -> {
                require(returned.handle == attempt.attempt) { "Apple denied a different account proof." }
                pending.copy(phase = CloudAccountMethodPhase.DENIED)
            }
        }
        update(pending, updated)
    }

    override suspend fun completeLink(localId: String, onMutationConfirmed: () -> Unit): CloudPendingAccountMethod = operationCoordinator.runExclusive {
        val pending = requirePending(localId)
        require(pending.intent == CloudAccountMethodIntent.LINK && pending.phase == CloudAccountMethodPhase.LINK_READY) {
            "Linking requires the new provider receipt and its separate proof binding."
        }
        val session = sessionFor(pending)
        val submitting = checkpoint(pending)
        gateway.redeemAccountLink(session.transport(), requireNotNull(pending.linkReceipt).completion, pending.verifier)
        onMutationConfirmed()
        update(submitting, submitting.copy(phase = CloudAccountMethodPhase.MUTATED))
    }

    override suspend fun resumeAppleReenable(localId: String, onMutationConfirmed: () -> Unit): CloudPendingAccountMethod = operationCoordinator.runExclusive {
        val pending = requirePending(localId)
        require(pending.method == CloudSignInMethod.APPLE && pending.intent == CloudAccountMethodIntent.REENABLE &&
            pending.phase == CloudAccountMethodPhase.APPLE_PROVED) { "Only the original proved Android Apple browser attempt can resume re-enable." }
        val session = sessionFor(pending)
        val submitting = checkpoint(pending)
        gateway.resumeAppleReenable(session.transport(), requireNotNull(pending.attempt).attempt, pending.verifier)
        onMutationConfirmed()
        update(submitting, submitting.copy(phase = CloudAccountMethodPhase.MUTATED))
    }

    override suspend fun unlink(localId: String, target: CloudProviderMethodTarget, onMutationConfirmed: () -> Unit): CloudPendingAccountMethod = operationCoordinator.runExclusive {
        val pending = requireProof(localId)
        val session = sessionFor(pending)
        require(loadCurrentTarget(pending, session, target).active) { "Only a currently active method can be unlinked." }
        val submitting = pending.copy(phase = CloudAccountMethodPhase.SUBMITTING, intent = CloudAccountMethodIntent.UNLINK, target = target)
        save(pending, submitting)
        gateway.unlinkAccountProvider(session.transport(), target, requireNotNull(pending.originalProof))
        onMutationConfirmed()
        update(submitting, submitting.copy(phase = CloudAccountMethodPhase.MUTATED))
    }

    override suspend fun cancel(localId: String) {
        val connectionPending = load()?.takeIf { it.localId == localId && it.connection?.operation != null &&
            it.phase !in setOf(CloudAccountMethodPhase.CONNECTED, CloudAccountMethodPhase.ALREADY_CONNECTED) }
        if (connectionPending != null) operationCoordinator.runExclusive {
            val session = sessionFor(connectionPending)
            gateway.accountConnection(session.transport(), connectionPending.verifier,
                CloudConnectionAction.Cancel(requireNotNull(connectionPending.connection?.operation)))
        }
        withContext(Dispatchers.IO) {
            val pending = load() ?: return@withContext
            require(pending.localId == localId) { "A different account proof is active." }
            preferencesStore.accountMethodStore.replace(pending, null)
        }
    }

    private suspend fun beginProvider(pending: PendingCloudAccountMethod, session: AuthenticatedCloudSession,
        onAttemptAccepted: () -> Unit): CloudPendingAccountMethod {
        val methods = socialGateway.loadAuthMethods(pending.configuration.authBaseUrl)
        requireRetained(pending)
        val provider = pending.method.provider()
        val availability = if (provider == CloudSocialProvider.GOOGLE) methods.google else methods.apple
        require(if (provider == CloudSocialProvider.GOOGLE) availability is CloudSocialProviderAvailability.Native
            else availability is CloudSocialProviderAvailability.Browser) { "The requested account proof transport is unavailable." }
        val attempt = gateway.beginAccountProvider(session.transport(), provider, pending.intent, challenge(pending.verifier),
            pending.originalProof, pending.target)
        onAttemptAccepted()
        return update(pending, pending.copy(attempt = attempt, phase = CloudAccountMethodPhase.PROVIDER,
            googleAudience = (availability as? CloudSocialProviderAvailability.Native)?.audience))
    }

    private fun withReceipt(pending: PendingCloudAccountMethod, receipt: CloudAccountMethodReceipt): PendingCloudAccountMethod {
        return if (pending.intent == CloudAccountMethodIntent.REAUTH) pending.copy(phase = CloudAccountMethodPhase.PROOF_READY,
            originalProof = CloudAccountMethodProof(receipt, pending.verifier))
        else pending.copy(phase = CloudAccountMethodPhase.LINK_READY, linkReceipt = receipt)
    }

    private suspend fun loadCurrentTarget(pending: PendingCloudAccountMethod, session: AuthenticatedCloudSession, target: CloudProviderMethodTarget): CloudAccountProviderMethod {
        val methods = gateway.loadAccountMethods(session.transport())
        requireRetained(pending)
        val current = methods.methods.singleOrNull { it.target == target }
        require(current != null && !current.revocationPending) {
            "The provider method changed or revocation cleanup is pending. Refresh methods, then start entirely fresh verification."
        }
        return current
    }

    private suspend fun requireProof(localId: String): PendingCloudAccountMethod {
        val pending = requirePending(localId)
        require(pending.intent == CloudAccountMethodIntent.REAUTH && pending.phase == CloudAccountMethodPhase.PROOF_READY &&
            pending.originalProof != null) { "A fresh original current-account proof is required." }
        return pending
    }

    private suspend fun requirePending(localId: String): PendingCloudAccountMethod {
        val pending = requireNotNull(load()) { "No account proof is stored. Start fresh verification." }
        require(pending.localId == localId) { "A different account proof is active." }
        requireContext(pending)
        requireNotExpired(pending)
        return pending
    }

    private suspend fun requireRetained(pending: PendingCloudAccountMethod) {
        requireContext(pending)
        check(load() == pending) { "Account proof was cancelled or replaced. Start fresh verification." }
    }

    private fun requireNotExpired(pending: PendingCloudAccountMethod) {
        if (pending.phase in setOf(CloudAccountMethodPhase.CONNECTION_CONFIRMING, CloudAccountMethodPhase.CONNECTED)) return
        if (pending.phase == CloudAccountMethodPhase.PROVIDER) check(
            requireNotNull(pending.attempt).expiresAtMillis > System.currentTimeMillis()) {
            "Provider proof expired. Start fresh account verification."
        }
        val expiry = pending.connection?.expiresAtMillis ?: when (pending.phase) {
            CloudAccountMethodPhase.PROOF_READY -> pending.originalProof?.receipt?.expiresAtMillis
            CloudAccountMethodPhase.LINK_READY -> pending.linkReceipt?.expiresAtMillis
            else -> pending.attempt?.expiresAtMillis
        }
        check(expiry == null || expiry > System.currentTimeMillis()) { "Account proof expired. Refresh methods and start fresh verification." }
    }

    private suspend fun currentSession(): AuthenticatedCloudSession {
        val session = sessionProvider.authenticatedSession()
        val current = preferencesStore.currentCloudSettings()
        require(current.cloudState == CloudAccountState.LINKED && current.linkedUserId == session.accountSnapshot.userId) {
            "Sign in to your current account before managing its sign-in methods."
        }
        check(preferencesStore.currentAccountDeletionState() == AccountDeletionState.Hidden) { "Finish account deletion before managing sign-in methods." }
        check(withContext(Dispatchers.IO) { preferencesStore.socialAuthStore.loadPending() } == null) {
            "Finish or cancel ordinary sign-in before managing sign-in methods."
        }
        return session
    }

    private suspend fun sessionFor(pending: PendingCloudAccountMethod): AuthenticatedCloudSession {
        requireContext(pending)
        val session = currentSession()
        requireRetained(pending)
        check(session.accountSnapshot.userId == pending.userId && session.configuration == pending.configuration) {
            "The authenticated account changed. Start fresh verification."
        }
        return session
    }

    private fun newPending(session: AuthenticatedCloudSession, method: CloudSignInMethod, epoch: String?): PendingCloudAccountMethod {
        val current = preferencesStore.currentCloudSettings()
        return PendingCloudAccountMethod(UUID.randomUUID().toString(), epoch, current.installationId, session.accountSnapshot.userId,
            current.linkedWorkspaceId, current.activeWorkspaceId, session.configuration,
            method, CloudAccountMethodIntent.REAUTH, CloudAccountMethodPhase.SUBMITTING, verifier(), null, null, null,
            null, null, null, null, false, null, null)
    }

    private fun requireContext(pending: PendingCloudAccountMethod) {
        val current = preferencesStore.currentCloudSettings()
        check(preferencesStore.accountMethodStore.epoch() == pending.epoch &&
            current.cloudState == CloudAccountState.LINKED && current.installationId == pending.installationId &&
            current.linkedUserId == pending.userId && current.linkedWorkspaceId == pending.workspaceId &&
            current.activeWorkspaceId == pending.activeWorkspaceId && preferencesStore.currentServerConfiguration() == pending.configuration &&
            preferencesStore.currentAccountDeletionState() == AccountDeletionState.Hidden &&
            preferencesStore.loadCredentials() != null) {
            "Account, session, installation, workspace or server changed. Start fresh verification."
        }
    }

    private suspend fun checkpoint(pending: PendingCloudAccountMethod): PendingCloudAccountMethod {
        val submitting = pending.copy(phase = CloudAccountMethodPhase.SUBMITTING)
        save(pending, submitting)
        return submitting
    }

    private suspend fun update(expected: PendingCloudAccountMethod, replacement: PendingCloudAccountMethod): CloudPendingAccountMethod {
        save(expected, replacement)
        return replacement.snapshot()
    }

    private suspend fun save(expected: PendingCloudAccountMethod?, replacement: PendingCloudAccountMethod) {
        withContext(NonCancellable + Dispatchers.IO) {
            requireContext(replacement)
            preferencesStore.accountMethodStore.replace(expected, replacement)
        }
    }

    private suspend fun load(): PendingCloudAccountMethod? = withContext(Dispatchers.IO) { preferencesStore.accountMethodStore.load() }
}

private fun AuthenticatedCloudSession.transport(): CloudAccountMethodSession =
    CloudAccountMethodSession(configuration.authBaseUrl, "Bearer ${credentials.idToken}")
private fun CloudSocialProvider.method(): CloudSignInMethod = when (this) {
    CloudSocialProvider.GOOGLE -> CloudSignInMethod.GOOGLE
    CloudSocialProvider.APPLE -> CloudSignInMethod.APPLE
}
private fun CloudSignInMethod.provider(): CloudSocialProvider = when (this) {
    CloudSignInMethod.GOOGLE -> CloudSocialProvider.GOOGLE
    CloudSignInMethod.APPLE -> CloudSocialProvider.APPLE
    CloudSignInMethod.EMAIL -> throw IllegalArgumentException("Email uses current-account OTP, not a provider attempt.")
}
private fun verifier(): String {
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}
private fun challenge(value: String): String = Base64.encodeToString(MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.US_ASCII)), Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
