package com.flashcardsopensourceapp.feature.settings.cloud.signIn

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

internal suspend fun requestCloudGoogleCredential(
    context: Context,
    serverClientId: String,
    rawServerNonce: String,
    onRequested: () -> Unit
): String {
    val option = GetSignInWithGoogleOption.Builder(serverClientId)
        .setNonce(rawServerNonce)
        .build()
    val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
    val manager = CredentialManager.create(context)
    onRequested()
    val credential = manager.getCredential(context = context, request = request).credential
    require(credential is CustomCredential &&
        credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
        "Google returned an unsupported credential. Start sign-in again."
    }
    return GoogleIdTokenCredential.createFrom(credential.data).idToken
}
