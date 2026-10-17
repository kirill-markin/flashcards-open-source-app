package com.flashcardsopensourceapp.feature.settings.account.methods

import android.content.Context
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.observability.analytics.Analytics
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsAuthCodeRequestAction
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsAuthCodeRequestOutcome
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsAuthCodeVerificationOutcome
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsAuthMethod
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsAuthProvider
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsAuthProviderOutcome
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsAuthAccountLinkOutcome
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSurface
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethods
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAuthMethods
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPendingAccountMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodPhase
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodIntent
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodLaunch
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSignInMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import com.flashcardsopensourceapp.data.local.model.cloud.CloudProviderMethodTarget
import com.flashcardsopensourceapp.data.local.repository.CloudAccountMethodsRepository
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.CloudSocialSignInRepository
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.cloud.signIn.cloudCodeRequestOutcome
import com.flashcardsopensourceapp.feature.settings.cloud.signIn.cloudCodeVerificationOutcome
import com.flashcardsopensourceapp.feature.settings.cloud.signIn.requestCloudGoogleCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AccountMethodsUiState(
    val linked: Boolean,
    val demoAccount: Boolean,
    val busy: Boolean,
    val methods: CloudAccountMethods?,
    val availability: CloudAuthMethods?,
    val pending: CloudPendingAccountMethod?,
    val email: String,
    val code: String,
    val error: String,
    val restartRequired: Boolean,
    val mutationConfirmed: Boolean
)

private fun initialAccountMethodsState(linked: Boolean, demoAccount: Boolean) = AccountMethodsUiState(
    linked, demoAccount, false, null, null, null, "", "", "", false, false
)

class AccountMethodsViewModel(
    private val repository: CloudAccountMethodsRepository,
    private val socialRepository: CloudSocialSignInRepository,
    accountRepository: CloudAccountRepository,
    private val analytics: Analytics,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val state = MutableStateFlow(initialAccountMethodsState(false, false))
    val uiState = state.asStateFlow()
    private var operation: Job? = null
    private var generation: Long = 0

    init {
        viewModelScope.launch {
            combine(accountRepository.observeCloudSettings(), accountRepository.observeServerConfiguration(),
                accountRepository.observeAccountDeletionState()) { settings, configuration, deletion ->
                Triple(settings.copy(updatedAtMillis = 0), configuration, deletion)
            }.distinctUntilChanged().collect { (settings, _, deletion) ->
                generation += 1
                operation?.cancel()
                val linked = settings.cloudState == CloudAccountState.LINKED && deletion == AccountDeletionState.Hidden
                // The reserved review email controls presentation only; server proof remains authoritative.
                val demoAccount = linked && settings.linkedEmail?.trim()?.endsWith("@example.com", ignoreCase = true) == true
                state.value = initialAccountMethodsState(linked, demoAccount)
                if (linked && !demoAccount) refresh()
            }
        }
    }

    fun email(value: String) { state.update { it.copy(email = value) } }
    fun code(value: String) { state.update { it.copy(code = value.filter { it in '0'..'9' }.take(8)) } }

    fun refresh() = runOperation {
        state.update { it.copy(methods = null, availability = null) }
        val methods = repository.loadMethods()
        val availability = socialRepository.loadAuthMethods()
        state.update { it.copy(methods = methods, availability = availability) }
        present(repository.resume())
    }

    fun reauthenticate(method: CloudSignInMethod, context: Context, launchApple: (String) -> Unit) = runOperation {
        state.value.pending?.let { repository.cancel(it.localId) }
        var requested = false
        var accepted = false
        val pending = try {
            repository.beginReauthentication(method, onEmailCodeRequestStarted = { requested = true }, onEmailCodeRequested = {
                accepted = true
                codeRequested(method)
            })
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            if (requested && !accepted) analytics.track(AnalyticsEvent.AuthCodeRequestFinished(method.analyticsMethod(),
                AnalyticsAuthCodeRequestAction.INITIAL, cloudCodeRequestOutcome(error), AnalyticsSurface.SETTINGS))
            throw error
        }
        present(pending)
        launchProvider(pending, context, launchApple)
    }

    fun link(provider: CloudSocialProvider, context: Context, launchApple: (String) -> Unit) = runOperation {
        val original = current()
        val pending = repository.beginLink(original.localId, provider) { currentAccountProofConfirmed(original) }
        present(pending)
        launchProvider(pending, context, launchApple)
    }

    fun connect() = runOperation { presentConnection(repository.beginConnection(current().localId)) }
    fun adoptConnection() = runOperation { presentConnection(repository.adoptConnection(current().localId)) }
    fun connectionProvider(provider: CloudSocialProvider, context: Context, launchApple: (String) -> Unit) = runOperation {
        val pending = repository.beginConnectionProvider(current().localId, provider)
        present(pending)
        launchProvider(pending, context, launchApple)
    }
    fun sendConnectionEmail() = runOperation {
        presentConnection(repository.sendConnectionEmail(current().localId, state.value.email))
    }
    fun previewConnection(omittedWorkspaceIds: List<String>) = runOperation {
        present(repository.previewConnection(current().localId, omittedWorkspaceIds))
    }
    fun confirmConnection() = runOperation {
        present(repository.confirmConnection(current().localId))
        refreshAfterMutation()
    }
    fun loadConnection() = runOperation { presentConnection(repository.loadConnection(requireNotNull(state.value.pending).localId)) }

    private suspend fun presentConnection(pending: CloudPendingAccountMethod) {
        present(pending)
        if (pending.connection?.proved == true && pending.phase == CloudAccountMethodPhase.CONNECTION_TARGET)
            present(repository.previewConnection(pending.localId, emptyList()))
    }

    fun reenable(target: CloudProviderMethodTarget, context: Context, launchApple: (String) -> Unit) = runOperation {
        val original = current()
        val pending = repository.beginReenable(original.localId, target) { currentAccountProofConfirmed(original) }
        present(pending)
        launchProvider(pending, context, launchApple)
    }

    fun unlink(target: CloudProviderMethodTarget) = runOperation {
        val pending = current()
        present(repository.unlink(pending.localId, target) { mutation(pending.copy(intent = CloudAccountMethodIntent.UNLINK)) })
        refreshAfterMutation()
    }

    fun confirmLink() = runOperation {
        val pending = current()
        present(repository.completeLink(pending.localId) { mutation(pending) })
        refreshAfterMutation()
    }

    fun resumeAppleReenable() = runOperation {
        val pending = current()
        present(repository.resumeAppleReenable(pending.localId) { mutation(pending) })
        refreshAfterMutation()
    }

    fun returned(candidate: CloudPendingAccountMethod, onConsumed: () -> Unit) = runOperation {
        // Re-read protected state: a queued callback cannot restore a cancelled or changed account.
        try {
            val retained = repository.resume()
            if (retained?.localId == candidate.localId) {
                val pending = if (retained.intent == CloudAccountMethodIntent.CONNECT &&
                    retained.phase == CloudAccountMethodPhase.PROVIDER) repository.loadConnection(retained.localId) else retained
                presentConnection(pending)
            }
        } finally { onConsumed() }
    }

    fun sendMailboxCode() = runOperation {
        val pending = current()
        var sent = false
        try {
            present(repository.requestMailboxCode(pending.localId, state.value.email) {
                sent = true
                codeRequested(pending.method)
                if (pending.method == CloudSignInMethod.APPLE && !pending.mailboxCodeRequested) providerReceived(AnalyticsAuthProvider.APPLE)
            })
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            if (!sent) analytics.track(AnalyticsEvent.AuthCodeRequestFinished(pending.method.analyticsMethod(),
                AnalyticsAuthCodeRequestAction.INITIAL, cloudCodeRequestOutcome(error), AnalyticsSurface.SETTINGS))
            throw error
        }
    }

    fun verifyCode() = runOperation {
        val pending = current()
        val method = pending.method.analyticsMethod()
        analytics.track(AnalyticsEvent.AuthCodeSubmitted(method, AnalyticsSurface.SETTINGS))
        var verified = false
        try {
            presentConnection(repository.verifyCode(pending.localId, state.value.code) {
                verified = true
                analytics.track(AnalyticsEvent.AuthCodeVerificationFinished(method,
                    AnalyticsAuthCodeVerificationOutcome.VERIFIED, AnalyticsSurface.SETTINGS))
            })
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            if (!verified) cloudCodeVerificationOutcome(error)?.let { outcome ->
                analytics.track(AnalyticsEvent.AuthCodeVerificationFinished(method, outcome, AnalyticsSurface.SETTINGS))
            }
            throw error
        }
    }

    fun codeFormShown() {
        state.value.pending?.let { analytics.track(AnalyticsEvent.AuthCodeFormShown(it.method.analyticsMethod(), AnalyticsSurface.SETTINGS)) }
    }

    fun cancel(onClosed: () -> Unit) = runOperation {
        state.value.pending?.let { repository.cancel(it.localId) }
        state.update { it.copy(pending = null, email = "", code = "", restartRequired = false, mutationConfirmed = false) }
        onClosed()
    }

    private suspend fun launchProvider(pending: CloudPendingAccountMethod, context: Context, launchApple: (String) -> Unit) {
        if (pending.phase != CloudAccountMethodPhase.PROVIDER) return
        when (val launch = repository.prepareProviderLaunch(pending.localId)) {
            is CloudAccountMethodLaunch.Apple -> {
                launchApple(launch.url)
                analytics.track(AnalyticsEvent.AuthProviderRequested(AnalyticsAuthProvider.APPLE, AnalyticsSurface.SETTINGS))
            }
            is CloudAccountMethodLaunch.Google -> {
                val token = try {
                    requestCloudGoogleCredential(context, launch.serverClientId, launch.rawServerNonce) {
                        analytics.track(AnalyticsEvent.AuthProviderRequested(AnalyticsAuthProvider.GOOGLE, AnalyticsSurface.SETTINGS))
                    }
                } catch (error: GetCredentialCancellationException) {
                    providerFinished(AnalyticsAuthProvider.GOOGLE, AnalyticsAuthProviderOutcome.CANCELLED)
                    throw error
                } catch (error: GetCredentialException) {
                    providerFinished(AnalyticsAuthProvider.GOOGLE, if (error is NoCredentialException)
                        AnalyticsAuthProviderOutcome.UNAVAILABLE else AnalyticsAuthProviderOutcome.PROVIDER_ERROR)
                    throw error
                } catch (error: GoogleIdTokenParsingException) {
                    providerFinished(AnalyticsAuthProvider.GOOGLE, AnalyticsAuthProviderOutcome.INVALID_RESPONSE)
                    throw error
                } catch (error: IllegalArgumentException) {
                    providerFinished(AnalyticsAuthProvider.GOOGLE, AnalyticsAuthProviderOutcome.INVALID_RESPONSE)
                    throw error
                }
                presentConnection(repository.submitGoogleCredential(pending.localId, token,
                    onProviderReturned = { providerReceived(AnalyticsAuthProvider.GOOGLE) },
                    onMutationConfirmed = { mutation(pending) }))
                if (state.value.pending?.phase == CloudAccountMethodPhase.MUTATED) refreshAfterMutation()
            }
        }
    }

    private suspend fun present(pending: CloudPendingAccountMethod?) {
        coroutineContext.ensureActive()
        state.update { it.copy(pending = pending, email = pending?.mailboxEmail ?: pending?.providerEmail.orEmpty(), code = "",
            restartRequired = pending?.phase in setOf(CloudAccountMethodPhase.SUBMITTING, CloudAccountMethodPhase.DENIED,
                CloudAccountMethodPhase.RESTART_REQUIRED), mutationConfirmed = pending?.phase == CloudAccountMethodPhase.MUTATED) }
    }

    private fun current(): CloudPendingAccountMethod {
        check(!state.value.restartRequired) { "Start fresh account verification." }
        return requireNotNull(state.value.pending)
    }

    private suspend fun refreshAfterMutation() {
        state.update { it.copy(methods = null) }
        val methods = repository.loadMethods()
        state.update { it.copy(methods = methods) }
    }

    private fun codeRequested(method: CloudSignInMethod) {
        analytics.track(AnalyticsEvent.AuthCodeRequestFinished(method.analyticsMethod(), AnalyticsAuthCodeRequestAction.INITIAL,
            AnalyticsAuthCodeRequestOutcome.ACCEPTED, AnalyticsSurface.SETTINGS))
    }

    private fun providerReceived(provider: AnalyticsAuthProvider) = providerFinished(provider, AnalyticsAuthProviderOutcome.CREDENTIAL_RECEIVED)
    private fun providerFinished(provider: AnalyticsAuthProvider, outcome: AnalyticsAuthProviderOutcome) {
        analytics.track(AnalyticsEvent.AuthProviderFinished(provider, outcome, AnalyticsSurface.SETTINGS))
    }
    private fun currentAccountProofConfirmed(pending: CloudPendingAccountMethod) {
        if (pending.method == CloudSignInMethod.APPLE && !pending.mailboxCodeRequested) providerReceived(AnalyticsAuthProvider.APPLE)
    }
    private fun mutation(pending: CloudPendingAccountMethod) {
        if (pending.method == CloudSignInMethod.APPLE && !pending.mailboxCodeRequested) providerReceived(AnalyticsAuthProvider.APPLE)
        if (pending.intent == CloudAccountMethodIntent.LINK) analytics.track(AnalyticsEvent.AuthAccountLinkFinished(
            pending.method.analyticsMethod(), AnalyticsAuthAccountLinkOutcome.LINKED, AnalyticsSurface.SETTINGS))
    }

    private fun runOperation(action: suspend () -> Unit) {
        if (state.value.busy || !state.value.linked || state.value.demoAccount) return
        val requestGeneration = generation
        state.update { it.copy(busy = true, error = "") }
        operation = viewModelScope.launch {
            try { action() }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                state.update { it.copy(restartRequired = true, error = strings.get(accountMethodError(error))) }
                // A one-use request may have succeeded. Refresh metadata without replaying its proof.
                try {
                    val methods = repository.loadMethods()
                    state.update { it.copy(methods = methods) }
                    val retained = repository.resume()
                    val recoverable = retained?.connection != null && retained.phase in setOf(
                        CloudAccountMethodPhase.CONNECTION_TARGET, CloudAccountMethodPhase.CONNECTION_PREVIEW,
                        CloudAccountMethodPhase.CONNECTION_CONFIRMING, CloudAccountMethodPhase.CONNECTED)
                    state.update { it.copy(pending = retained, restartRequired = !recoverable) }
                } catch (refreshError: CancellationException) { throw refreshError }
                catch (_: Exception) { state.update { it.copy(error = it.error + "\n" +
                    strings.get(R.string.settings_methods_refresh_failed)) } }
            } finally { if (generation == requestGeneration) state.update { it.copy(busy = false) } }
        }
    }
}

private fun CloudSignInMethod.analyticsMethod(): AnalyticsAuthMethod = when (this) {
    CloudSignInMethod.GOOGLE -> AnalyticsAuthMethod.GOOGLE
    CloudSignInMethod.EMAIL -> AnalyticsAuthMethod.EMAIL
    CloudSignInMethod.APPLE -> AnalyticsAuthMethod.APPLE
}

private fun accountMethodError(error: Exception): Int = when {
    error is GetCredentialCancellationException -> R.string.settings_auth_cancelled
    error is GetCredentialException -> R.string.settings_auth_google_failed
    error is com.flashcardsopensourceapp.data.local.model.cloud.CloudConnectionWorkspaceUnavailableException ->
        R.string.settings_connection_workspace_required
    error is IOException -> R.string.settings_auth_network_restart
    error is CloudRemoteException -> when (error.errorCode) {
        "LAST_USABLE_METHOD" -> R.string.settings_methods_last_usable
        "PROVIDER_METHOD_CHANGED" -> R.string.settings_methods_changed
        "PROVIDER_METHOD_CLEANUP_REQUIRED", "APPLE_REVOCATION_PENDING" -> R.string.settings_methods_cleanup
        "PROVIDER_ENROLLMENT_CONFLICT" -> R.string.settings_methods_conflict
        "ACCOUNT_CONNECTION_PREVIEW_CHANGED" -> R.string.settings_connection_changed
        "ACCOUNT_CONNECTION_RESTART_REQUIRED" -> R.string.settings_connection_restart
        "ACCOUNT_CONNECTION_RATE_LIMITED" -> R.string.settings_connection_rate_limited
        "ACCOUNT_CONNECTION_INVALID" -> R.string.settings_connection_invalid
        else -> R.string.settings_methods_fresh
    }
    else -> R.string.settings_methods_fresh
}

fun createAccountMethodsViewModelFactory(
    repository: CloudAccountMethodsRepository,
    socialRepository: CloudSocialSignInRepository,
    accountRepository: CloudAccountRepository,
    analytics: Analytics,
    applicationContext: Context
): ViewModelProvider.Factory = viewModelFactory {
    initializer { AccountMethodsViewModel(repository, socialRepository, accountRepository, analytics,
        createSettingsStringResolver(applicationContext)) }
}
