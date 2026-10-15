package com.flashcardsopensourceapp.feature.settings.cloud.signIn

import android.content.Context
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.flashcardsopensourceapp.core.observability.analytics.Analytics
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsAuthCodeRequestAction
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsAuthCodeRequestOutcome
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsAuthCodeVerificationOutcome
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsAuthMethod
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsAuthProvider
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsAuthProviderOutcome
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSignInFailureReason
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSurface
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAuthMethods
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPendingSocialSignIn
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialNonce
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProviderAvailability
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialSignInPhase
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSuccessfulSignInHint
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.repository.CloudSocialSignInRepository
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class CloudSignInEntryStep { METHODS, EMAIL, PROVIDER, MAILBOX }

data class CloudProviderSignInUiState(
    val methods: CloudAuthMethods?,
    val hint: CloudSuccessfulSignInHint?,
    val step: CloudSignInEntryStep,
    val busy: Boolean,
    val remember: Boolean,
    val email: String,
    val code: String,
    val codeRequested: Boolean,
    val requiresRestart: Boolean,
    val error: String,
    val prepared: Boolean
)

class CloudProviderSignInController internal constructor(
    private val repository: CloudSocialSignInRepository,
    private val scope: CoroutineScope,
    private val analytics: Analytics,
    private val surface: AnalyticsSurface,
    private val origin: AnalyticsSurface?,
    private val strings: SettingsStringResolver,
    private val onPrepared: (String, AnalyticsAuthMethod, CloudWorkspaceLinkContext, CloudWorkspaceLinkSelection?) -> Unit
) {
    private val mutableState = MutableStateFlow(CloudProviderSignInUiState(
        methods = null, hint = null, step = CloudSignInEntryStep.METHODS, busy = false, remember = true,
        email = "", code = "", codeRequested = false, requiresRestart = false, error = "", prepared = false
    ))
    val uiState = mutableState.asStateFlow()
    private var pending: CloudPendingSocialSignIn? = null
    private var generation: Long = 0
    private var loaded: Boolean = false

    fun load() = runOperation {
        val methods = repository.loadAuthMethods()
        val hint = repository.rememberedSignIn()
        mutableState.update { it.copy(methods = methods, hint = hint) }
        if (!loaded) {
            loaded = true
            repository.resumePendingSignIn()?.let { resume(it) }
        }
    }

    fun remember(value: Boolean) { mutableState.update { it.copy(remember = value) } }
    fun email(value: String) { mutableState.update { it.copy(email = value) } }
    fun code(value: String) { mutableState.update { it.copy(code = value.filter { character -> character in '0'..'9' }.take(8)) } }
    fun consumePrepared() { mutableState.update { it.copy(prepared = false) } }
    fun mailboxFormShown() {
        pending?.let { analytics.track(AnalyticsEvent.AuthCodeFormShown(it.provider.analyticsMethod(), surface)) }
    }
    fun close(onClosed: () -> Unit) = runOperation {
        pending?.let { current ->
            if (current.phase != CloudSocialSignInPhase.ACCEPTED) analytics.track(AnalyticsEvent.SignInFailedWithMethod(
                current.provider.analyticsMethod(), AnalyticsSignInFailureReason.CANCELLED, origin
            ))
        }
        cancelPending()
        resetEntry()
        onClosed()
    }
    fun selectEmail() = runOperation {
        cancelPending()
        analytics.track(AnalyticsEvent.AuthMethodSelected(AnalyticsAuthMethod.EMAIL, surface))
        mutableState.update { it.copy(step = CloudSignInEntryStep.EMAIL, error = "", prepared = false) }
    }

    fun forget() = runOperation {
        repository.forgetRememberedSignIn()
        mutableState.update { it.copy(hint = null) }
    }

    fun anotherMethod() = runOperation {
        cancelPending()
        resetEntry()
    }

    fun google(context: Context) = runOperation {
        cancelPending()
        val method = requireNotNull(mutableState.value.methods).google
        require(method is CloudSocialProviderAvailability.Native && method.nonce == CloudSocialNonce.RAW)
        analytics.track(AnalyticsEvent.AuthMethodSelected(AnalyticsAuthMethod.GOOGLE, surface))
        val current = repository.beginGoogleLogin(mutableState.value.remember)
        pending = current
        val token = try {
            requestCloudGoogleCredential(context, method.audience, requireNotNull(current.nonce)) {
                analytics.track(AnalyticsEvent.AuthProviderRequested(AnalyticsAuthProvider.GOOGLE, surface))
            }
        } catch (_: GetCredentialCancellationException) {
            analytics.track(AnalyticsEvent.AuthProviderFinished(AnalyticsAuthProvider.GOOGLE,
                AnalyticsAuthProviderOutcome.CANCELLED, surface))
            cancelPending()
            mutableState.update { it.copy(error = strings.get(R.string.settings_auth_cancelled)) }
            return@runOperation
        } catch (error: GetCredentialException) {
            analytics.track(AnalyticsEvent.AuthProviderFinished(AnalyticsAuthProvider.GOOGLE,
                if (error is NoCredentialException) AnalyticsAuthProviderOutcome.UNAVAILABLE
                else AnalyticsAuthProviderOutcome.PROVIDER_ERROR, surface))
            throw error
        } catch (error: GoogleIdTokenParsingException) {
            analytics.track(AnalyticsEvent.AuthProviderFinished(AnalyticsAuthProvider.GOOGLE,
                AnalyticsAuthProviderOutcome.INVALID_RESPONSE, surface))
            throw error
        } catch (error: IllegalArgumentException) {
            analytics.track(AnalyticsEvent.AuthProviderFinished(AnalyticsAuthProvider.GOOGLE,
                AnalyticsAuthProviderOutcome.INVALID_RESPONSE, surface))
            throw error
        }
        analytics.track(AnalyticsEvent.AuthProviderFinished(AnalyticsAuthProvider.GOOGLE,
            AnalyticsAuthProviderOutcome.CREDENTIAL_RECEIVED, surface))
        try {
            resume(repository.submitGoogleCredential(current.localId, token))
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            reportFailure(AnalyticsAuthMethod.GOOGLE, error)
            throw error
        }
    }

    fun apple(launch: (String) -> Unit) = runOperation {
        cancelPending()
        analytics.track(AnalyticsEvent.AuthMethodSelected(AnalyticsAuthMethod.APPLE, surface))
        val browser = repository.beginAppleLogin(mutableState.value.remember)
        pending = repository.resumePendingSignIn()
        launch(browser.url)
        analytics.track(AnalyticsEvent.AuthProviderRequested(AnalyticsAuthProvider.APPLE, surface))
        mutableState.update { it.copy(step = CloudSignInEntryStep.PROVIDER) }
    }

    fun returned(candidate: CloudPendingSocialSignIn) = runOperation {
        // The opaque return is only a candidate: redemption/mailbox calls prove PKCE on the server.
        try {
            resume(candidate)
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            reportFailure(candidate.provider.analyticsMethod(), error)
            throw error
        }
    }

    fun sendMailboxCode() = runOperation {
        val current = requireNotNull(pending)
        check(!mutableState.value.codeRequested && !mutableState.value.requiresRestart)
        val method = current.provider.analyticsMethod()
        var accepted = false
        try {
            repository.requestMailboxCode(current.localId, mutableState.value.email, onRequested = {
                accepted = true
                analytics.track(AnalyticsEvent.SignInCodeRequestedWithMethod(method, surface))
                analytics.track(AnalyticsEvent.AuthCodeRequestFinished(method, AnalyticsAuthCodeRequestAction.INITIAL,
                    AnalyticsAuthCodeRequestOutcome.ACCEPTED, surface))
            }, onCredentialReceived = ::reportAppleCredentialReceived)
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            if (!accepted) analytics.track(AnalyticsEvent.AuthCodeRequestFinished(method, AnalyticsAuthCodeRequestAction.INITIAL,
                cloudCodeRequestOutcome(error), surface))
            reportFailure(method, error)
            throw error
        }
        mutableState.update { it.copy(codeRequested = true) }
    }

    fun verifyMailboxCode() = runOperation {
        val current = requireNotNull(pending)
        val method = current.provider.analyticsMethod()
        check(mutableState.value.codeRequested && !mutableState.value.requiresRestart)
        require(mutableState.value.code.length in 6..8)
        analytics.track(AnalyticsEvent.AuthCodeSubmitted(method, surface))
        var proofVerified = false
        var verificationInvoked = false
        val verified = try {
            repository.verifyMailboxCode(current.localId, mutableState.value.code,
                onVerificationStarted = { verificationInvoked = true }) {
                proofVerified = true
                analytics.track(AnalyticsEvent.AuthCodeVerificationFinished(method,
                    AnalyticsAuthCodeVerificationOutcome.VERIFIED, surface))
            }
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            // An ambiguous response can have consumed the proof. Never offer blind verification replay.
            mutableState.update { it.copy(requiresRestart = true) }
            if (verificationInvoked && !proofVerified) cloudCodeVerificationOutcome(error)?.let { outcome ->
                analytics.track(AnalyticsEvent.AuthCodeVerificationFinished(method,
                    outcome, surface))
            }
            reportFailure(method, error)
            throw error
        }
        resume(verified)
    }

    private suspend fun resume(current: CloudPendingSocialSignIn) {
        pending = current
        when (current.phase) {
            CloudSocialSignInPhase.PROVIDER -> mutableState.update { it.copy(step = CloudSignInEntryStep.PROVIDER) }
            CloudSocialSignInPhase.DENIED -> {
                // A deep link alone cannot establish a provider denial or its correlation.
                mutableState.update { it.copy(step = CloudSignInEntryStep.METHODS,
                    error = strings.get(R.string.settings_auth_return_rejected), requiresRestart = true) }
            }
            CloudSocialSignInPhase.INTERRUPTED_MAILBOX -> mutableState.update { it.copy(
                step = CloudSignInEntryStep.MAILBOX, code = "", codeRequested = current.mailboxCodeRequested,
                requiresRestart = true, error = strings.get(R.string.settings_auth_fresh_attempt)) }
            CloudSocialSignInPhase.MAILBOX -> mutableState.update { it.copy(step = CloudSignInEntryStep.MAILBOX,
                email = current.providerEmail.orEmpty(), code = "", codeRequested = current.mailboxCodeRequested, requiresRestart = false) }
            CloudSocialSignInPhase.COMPLETION, CloudSocialSignInPhase.ACCEPTED -> {
                val context = try {
                    repository.prepareSignIn(current.localId, ::reportAppleCredentialReceived) {
                        analytics.track(AnalyticsEvent.AuthSessionAccepted(current.provider.analyticsMethod(), surface))
                        analytics.track(AnalyticsEvent.SignInSucceededWithMethod(current.provider.analyticsMethod(), surface))
                    }
                } finally {
                    val stored = repository.resumePendingSignIn()
                    if (stored?.localId == current.localId) pending = stored
                }
                onPrepared(current.localId, current.provider.analyticsMethod(), context, current.workspaceSelection)
                mutableState.update { it.copy(prepared = true) }
            }
        }
    }

    fun resetEntry() {
        generation += 1
        mutableState.update { it.copy(step = CloudSignInEntryStep.METHODS, error = "", code = "",
            email = "", codeRequested = false, requiresRestart = false, prepared = false) }
    }

    private fun reportAppleCredentialReceived() {
        // Opaque browser returns are untrusted; this boundary is the server's PKCE-validated response.
        analytics.track(AnalyticsEvent.AuthProviderFinished(
            AnalyticsAuthProvider.APPLE, AnalyticsAuthProviderOutcome.CREDENTIAL_RECEIVED, surface
        ))
    }

    private suspend fun cancelPending() {
        pending?.let { repository.cancelSignIn(it.localId) }
        pending = null
    }

    private fun reportFailure(method: AnalyticsAuthMethod, error: Exception) {
        analytics.track(AnalyticsEvent.SignInFailedWithMethod(method,
            if (error is CloudRemoteException && error.statusCode == 429) AnalyticsSignInFailureReason.RATE_LIMITED
            else AnalyticsSignInFailureReason.SERVER_ERROR, origin))
    }

    private fun runOperation(action: suspend () -> Unit) {
        if (mutableState.value.busy) return
        val requestGeneration = generation
        mutableState.update { it.copy(busy = true, error = "") }
        scope.launch {
            try {
                action()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (requestGeneration == generation) mutableState.update { it.copy(
                    error = strings.get(when (error) {
                        is IOException -> R.string.settings_auth_network_restart
                        is GetCredentialException -> R.string.settings_auth_google_failed
                        else -> R.string.settings_auth_fresh_attempt
                    }), requiresRestart = true
                ) }
            } finally {
                mutableState.update { it.copy(busy = false) }
            }
        }
    }
}

internal fun CloudSocialProvider.analyticsMethod(): AnalyticsAuthMethod = when (this) {
    CloudSocialProvider.APPLE -> AnalyticsAuthMethod.APPLE
    CloudSocialProvider.GOOGLE -> AnalyticsAuthMethod.GOOGLE
}

internal fun cloudCodeRequestOutcome(error: Exception): AnalyticsAuthCodeRequestOutcome = when {
    error is java.net.SocketTimeoutException -> AnalyticsAuthCodeRequestOutcome.TIMEOUT
    error is IOException -> AnalyticsAuthCodeRequestOutcome.OFFLINE
    error is CloudRemoteException && error.statusCode == 429 -> AnalyticsAuthCodeRequestOutcome.RATE_LIMITED
    else -> AnalyticsAuthCodeRequestOutcome.SERVER_ERROR
}

internal fun cloudCodeVerificationOutcome(error: Exception): AnalyticsAuthCodeVerificationOutcome? {
    when {
        error is java.net.SocketTimeoutException -> return AnalyticsAuthCodeVerificationOutcome.TIMEOUT
        error is IOException -> return AnalyticsAuthCodeVerificationOutcome.OFFLINE
        error is CloudRemoteException && error.statusCode?.let { it >= 500 } == true -> return AnalyticsAuthCodeVerificationOutcome.SERVER_ERROR
        error is CloudRemoteException && error.statusCode == 429 -> return AnalyticsAuthCodeVerificationOutcome.RATE_LIMITED
    }
    if (error !is CloudRemoteException) return null
    return when (error.errorCode) {
        "OTP_CODE_INVALID" -> AnalyticsAuthCodeVerificationOutcome.INVALID_CODE
        "OTP_SESSION_EXPIRED" -> AnalyticsAuthCodeVerificationOutcome.EXPIRED_CODE
        "OTP_CHALLENGE_CONSUMED" -> AnalyticsAuthCodeVerificationOutcome.CODE_ALREADY_USED
        "OTP_TOO_MANY_ATTEMPTS", "RATE_LIMITED" -> AnalyticsAuthCodeVerificationOutcome.RATE_LIMITED
        else -> null
    }
}
