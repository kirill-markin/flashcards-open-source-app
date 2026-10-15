package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethods
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPendingAccountMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSignInMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import com.flashcardsopensourceapp.data.local.model.cloud.CloudProviderMethodTarget
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodLaunch
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAppleBrowserReturn

interface CloudAccountMethodsRepository {
    suspend fun loadMethods(): CloudAccountMethods
    suspend fun resume(): CloudPendingAccountMethod?
    suspend fun beginReauthentication(method: CloudSignInMethod, onEmailCodeRequestStarted: () -> Unit, onEmailCodeRequested: () -> Unit): CloudPendingAccountMethod
    suspend fun beginLink(localId: String, provider: CloudSocialProvider, onCurrentAccountProofConfirmed: () -> Unit): CloudPendingAccountMethod
    suspend fun beginReenable(localId: String, target: CloudProviderMethodTarget, onCurrentAccountProofConfirmed: () -> Unit): CloudPendingAccountMethod
    suspend fun prepareProviderLaunch(localId: String): CloudAccountMethodLaunch
    suspend fun submitGoogleCredential(localId: String, identityToken: String, onProviderReturned: () -> Unit, onMutationConfirmed: () -> Unit): CloudPendingAccountMethod
    suspend fun requestMailboxCode(localId: String, email: String, onRequested: () -> Unit): CloudPendingAccountMethod
    suspend fun verifyCode(localId: String, code: String, onProofConfirmed: () -> Unit): CloudPendingAccountMethod
    suspend fun hasPendingManagementPurpose(): Boolean
    suspend fun acceptAppleReturn(returned: CloudAppleBrowserReturn): CloudPendingAccountMethod
    suspend fun completeLink(localId: String, onMutationConfirmed: () -> Unit): CloudPendingAccountMethod
    suspend fun resumeAppleReenable(localId: String, onMutationConfirmed: () -> Unit): CloudPendingAccountMethod
    suspend fun unlink(localId: String, target: CloudProviderMethodTarget, onMutationConfirmed: () -> Unit): CloudPendingAccountMethod
    suspend fun cancel(localId: String)
}
