package com.flashcardsopensourceapp.data.local.migrations

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.CloudAcceptedSocialSession
import com.flashcardsopensourceapp.data.local.cloud.CloudCredentialStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudSocialAttemptBinding
import com.flashcardsopensourceapp.data.local.cloud.CloudSocialGuestBinding
import com.flashcardsopensourceapp.data.local.cloud.PendingCloudSocialSignIn
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudProviderSignInHint
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialEmailRelationship
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginAttempt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginCompletion
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.cloud.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.support.clearLocalDatabaseSharedPreferences
import com.flashcardsopensourceapp.data.local.support.createInMemoryAppDatabase
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CloudSocialAuthStorageContractTest {
    private lateinit var context: Context
    private lateinit var database: AppDatabase

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        clearLocalDatabaseSharedPreferences(context)
        database = createInMemoryAppDatabase(context)
    }

    @After
    fun tearDown() {
        database.close()
        clearLocalDatabaseSharedPreferences(context)
    }

    @Test
    fun previousEncryptedRecordAddsOptionalSocialFieldsWithoutLosingCredentials() {
        val store = CloudPreferencesStore(context, database)
        val installed = StoredCloudCredentials("existing-refresh", "existing-id", Long.MAX_VALUE)
        store.saveCredentials(installed)
        val file = File(context.filesDir, "flashcards-cloud-secrets-encrypted.bin")
        val keyStore = KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)
        val key = (keyStore.getEntry("flashcards-cloud-secrets-aes-gcm-v1", null) as KeyStore.SecretKeyEntry).secretKey
        val payload = file.readBytes()
        val associatedData = "flashcards-cloud-secrets-encrypted:v1".toByteArray(Charsets.UTF_8)
        val decrypt = Cipher.getInstance("AES/GCM/NoPadding")
        decrypt.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, payload.copyOfRange(1, 13)))
        decrypt.updateAAD(associatedData)
        val fields = JSONObject(decrypt.doFinal(payload.copyOfRange(13, payload.size)).toString(Charsets.UTF_8))
        fields.remove("pendingSocialSignIn")
        fields.remove("successfulSignInHint")
        val encrypt = Cipher.getInstance("AES/GCM/NoPadding")
        encrypt.init(Cipher.ENCRYPT_MODE, key)
        encrypt.updateAAD(associatedData)
        file.writeBytes(byteArrayOf(1) + encrypt.iv + encrypt.doFinal(fields.toString().toByteArray(Charsets.UTF_8)))

        val restarted = CloudPreferencesStore(context, database)
        assertEquals(installed, restarted.loadCredentials())
        assertNull(restarted.socialAuthStore.loadPending())
        assertNull(restarted.socialAuthStore.loadHint(makeOfficialCloudServiceConfiguration()))
        restarted.updateIdToken("renewed-id", Long.MAX_VALUE)
        assertEquals("existing-refresh", store.loadCredentials()?.refreshToken)
        assertEquals("renewed-id", store.loadCredentials()?.idToken)
    }

    @Test
    fun encryptedAttemptAndAcceptedHintSurviveRestartWithoutReplacingInstalledCredentials() {
        val configuration = makeOfficialCloudServiceConfiguration()
        val store = CloudPreferencesStore(context, database)
        val installed = StoredCloudCredentials("installed-refresh", "installed-id", Long.MAX_VALUE)
        store.saveCredentials(installed)
        val hint = CloudProviderSignInHint(
            method = CloudSocialProvider.APPLE,
            recoveryEmail = "recovery@example.com",
            providerEmail = "private@privaterelay.appleid.com",
            emailRelationship = CloudSocialEmailRelationship.DIFFERENT_FROM_RECOVERY
        )
        val originalBinding = CloudSocialAttemptBinding(
            CloudSocialLoginAttempt("original-attempt", "original-nonce", Long.MAX_VALUE, null, "original-challenge"),
            "original-verifier-secret"
        )
        val acceptedCredentials = StoredCloudCredentials("accepted-refresh-secret", "accepted-id-secret", Long.MAX_VALUE)
        val completedWorkspace = CloudWorkspaceSummary("merged-workspace", "Personal", 1L, true)
        val pending = PendingCloudSocialSignIn(
            installationId = store.currentCloudSettings().installationId,
            linkedUserId = store.currentCloudSettings().linkedUserId,
            linkedWorkspaceId = store.currentCloudSettings().linkedWorkspaceId,
            activeWorkspaceId = store.currentCloudSettings().activeWorkspaceId,
            guestBinding = CloudSocialGuestBinding("guest-user", "guest-workspace"),
            acceptedUserId = "accepted-user",
            configuration = configuration,
            provider = CloudSocialProvider.APPLE,
            binding = CloudSocialAttemptBinding(
                CloudSocialLoginAttempt("attempt", "nonce-secret", Long.MAX_VALUE, "com.nibomo.app:/auth/social/apple", "challenge"),
                "new-verifier-secret"
            ),
            originalReauthenticationBinding = originalBinding,
            rememberSignIn = true,
            mailboxReason = null,
            providerEmail = null,
            completion = CloudSocialLoginCompletion("completion-secret", Long.MAX_VALUE),
            acceptedSession = CloudAcceptedSocialSession(
                acceptedCredentials,
                hint
            ),
            preparedContext = CloudWorkspaceLinkContext(
                userId = "accepted-user",
                email = null,
                credentials = acceptedCredentials,
                workspaces = emptyList(),
                postAuthRoute = CloudWorkspacePostAuthRoute.NONE,
                guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
                preferredWorkspaceId = null
            ),
            workspaceSelection = CloudWorkspaceLinkSelection.CreateNew,
            completedWorkspace = completedWorkspace,
            linkingWorkspace = completedWorkspace
        )
        store.socialAuthStore.savePending(pending)
        val restarted = CloudPreferencesStore(context, database)
        assertEquals(pending, restarted.socialAuthStore.loadPending())
        assertEquals(installed, restarted.loadCredentials())
        assertNull(restarted.socialAuthStore.loadHint(configuration))
        restarted.socialAuthStore.completeAcceptedSession(pending)
        assertEquals(hint, store.socialAuthStore.loadHint(configuration))

        val ciphertext = File(context.filesDir, "flashcards-cloud-secrets-encrypted.bin").readBytes()
            .toString(Charsets.ISO_8859_1)
        listOf("installed-refresh", "accepted-refresh-secret", "new-verifier-secret", "recovery@example.com", "privaterelay.appleid.com")
            .forEach { secret -> assertFalse(ciphertext.contains(secret)) }
        assertFalse(context.getSharedPreferences("flashcards-cloud-secrets", Context.MODE_PRIVATE).contains("pending-social-sign-in"))

        store.socialAuthStore.savePending(pending.copy(acceptedSession = null))
        store.socialAuthStore.clearPending()
        assertEquals(hint, restarted.socialAuthStore.loadHint(configuration))
        store.socialAuthStore.savePending(pending)
        restarted.socialAuthStore.forgetHint()
        val forgotten = requireNotNull(store.socialAuthStore.loadPending())
        assertFalse(forgotten.rememberSignIn)
        store.socialAuthStore.completeAcceptedSession(forgotten)
        assertNull(restarted.socialAuthStore.loadHint(configuration))
        assertEquals(installed, store.loadCredentials())
        store.clearCredentials()
        assertNull(CloudCredentialStore(context).load().pendingSocialSignIn)
        assertNull(restarted.socialAuthStore.loadHint(configuration))
    }
}
