package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAuthMethods
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPendingSocialSignIn
import com.flashcardsopensourceapp.data.local.model.cloud.CloudProviderSignInHint
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary

interface CloudSocialSignInRepository {
    suspend fun loadAuthMethods(): CloudAuthMethods
    suspend fun beginGoogleLogin(rememberSignIn: Boolean): CloudPendingSocialSignIn
    suspend fun resumePendingSignIn(): CloudPendingSocialSignIn?
    suspend fun submitGoogleCredential(attempt: String, identityToken: String): CloudPendingSocialSignIn
    suspend fun requestMailboxCode(attempt: String, email: String)
    suspend fun verifyMailboxCode(attempt: String, code: String): CloudPendingSocialSignIn
    suspend fun prepareSignIn(attempt: String): CloudWorkspaceLinkContext
    suspend fun completeSignIn(attempt: String, selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary
    suspend fun cancelSignIn(attempt: String)
    suspend fun rememberedSignIn(): CloudProviderSignInHint?
    suspend fun forgetRememberedSignIn()
    suspend fun signOutAndForget()
}
