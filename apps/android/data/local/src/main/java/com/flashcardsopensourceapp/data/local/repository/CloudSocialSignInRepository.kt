package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAppleBrowserLaunch
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAppleBrowserReturn
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAuthMethods
import com.flashcardsopensourceapp.data.local.model.cloud.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPendingSocialSignIn
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSuccessfulSignInHint
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary

interface CloudSocialSignInRepository {
    suspend fun loadAuthMethods(): CloudAuthMethods
    suspend fun beginGoogleLogin(rememberSignIn: Boolean): CloudPendingSocialSignIn
    suspend fun beginAppleLogin(rememberSignIn: Boolean): CloudAppleBrowserLaunch
    suspend fun acceptAppleBrowserReturn(returned: CloudAppleBrowserReturn): CloudPendingSocialSignIn
    suspend fun verifyEmailCode(
        challenge: CloudOtpChallenge,
        code: String,
        rememberSignIn: Boolean,
        onVerificationStarted: () -> Unit,
        onVerified: () -> Unit
    ): CloudWorkspaceLinkContext
    suspend fun completeEmailSignInHint(context: CloudWorkspaceLinkContext)
    suspend fun resumePendingSignIn(): CloudPendingSocialSignIn?
    // Pending operations use CloudPendingSocialSignIn.localId; Apple may not return a server attempt.
    suspend fun submitGoogleCredential(attempt: String, identityToken: String): CloudPendingSocialSignIn
    suspend fun requestMailboxCode(attempt: String, email: String, onRequested: () -> Unit, onCredentialReceived: () -> Unit)
    suspend fun verifyMailboxCode(attempt: String, code: String, onVerificationStarted: () -> Unit, onVerified: () -> Unit): CloudPendingSocialSignIn
    suspend fun prepareSignIn(attempt: String, onCredentialReceived: () -> Unit, onSessionAccepted: () -> Unit): CloudWorkspaceLinkContext
    suspend fun completeSignIn(attempt: String, selection: CloudWorkspaceLinkSelection, onGuestCompletionStarted: () -> Unit, onGuestCompletionFinished: () -> Unit): CloudWorkspaceSummary
    suspend fun completeSignInHint(attempt: String)
    suspend fun cancelSignIn(attempt: String)
    suspend fun rememberedSignIn(): CloudSuccessfulSignInHint?
    suspend fun forgetRememberedSignIn()
    suspend fun signOutAndForget()
}
