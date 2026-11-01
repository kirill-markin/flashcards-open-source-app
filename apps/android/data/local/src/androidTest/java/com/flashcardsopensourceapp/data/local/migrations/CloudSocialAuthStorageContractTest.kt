package com.flashcardsopensourceapp.data.local.migrations

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.CloudAppleBrowserBinding
import com.flashcardsopensourceapp.data.local.cloud.CloudAcceptedSocialSession
import com.flashcardsopensourceapp.data.local.cloud.CloudCredentialStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudSocialAttemptBinding
import com.flashcardsopensourceapp.data.local.cloud.CloudSocialGuestBinding
import com.flashcardsopensourceapp.data.local.cloud.PendingCloudEmailSignIn
import com.flashcardsopensourceapp.data.local.cloud.wire.parseCloudEmailSignInHint
import com.flashcardsopensourceapp.data.local.cloud.PendingCloudSocialSignIn
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAppleBrowserStatus
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSignInMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialSignInPhase
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSuccessfulSignInHint
import com.flashcardsopensourceapp.data.local.model.cloud.parseCloudAppleBrowserReturn
import com.flashcardsopensourceapp.data.local.model.cloud.successfulHint
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
import android.util.Base64
import java.security.SecureRandom
import java.util.UUID
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
    fun genuineBrowserBindingAndTypedReturnSurviveEncryptedRestartWithoutServerMetadata() {
        val store = CloudPreferencesStore(context, database)
        val configuration = makeOfficialCloudServiceConfiguration()
        val verifierBytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val verifier = Base64.encodeToString(verifierBytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        val browser = CloudAppleBrowserBinding(UUID.randomUUID().toString(), verifier, null)
        val origin = store.currentCloudSettings()
        val pending = PendingCloudSocialSignIn(
            installationId = origin.installationId,
            linkedUserId = origin.linkedUserId,
            linkedWorkspaceId = origin.linkedWorkspaceId,
            activeWorkspaceId = origin.activeWorkspaceId,
            guestBinding = null,
            acceptedUserId = null,
            configuration = configuration,
            provider = CloudSocialProvider.APPLE,
            binding = null,
            appleBrowser = browser,
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
        store.socialAuthStore.savePending(pending)
        val restarted = CloudPreferencesStore(context, database)
        val restored = requireNotNull(restarted.socialAuthStore.loadPending())
        assertEquals(browser, restored.appleBrowser)
        assertNull(restored.binding)
        assertNull(restored.snapshot().nonce)
        assertNull(restored.snapshot().expiresAtMillis)
        assertNull(restored.snapshot().mailboxReason)
        assertNull(restored.snapshot().providerEmail)
        assertEquals(browser.localId, restored.snapshot().localId)
        assertNull(restored.snapshot().attempt)

        // Opaque transport bytes exercise parsing/storage only; no provider or server proof is claimed.
        val opaque = Base64.encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) },
            Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        val returned = parseCloudAppleBrowserReturn(
            "com.nibomo.app:/auth/social/apple#status=completed&completion=" + opaque
        )
        restarted.socialAuthStore.savePending(restored.copy(appleBrowser = browser.copy(returned = returned)))
        val callback = requireNotNull(CloudPreferencesStore(context, database).socialAuthStore.loadPending())
        assertEquals(CloudAppleBrowserStatus.COMPLETED, callback.appleBrowser?.returned?.status)
        assertEquals(CloudSocialSignInPhase.COMPLETION, callback.snapshot().phase)
        assertEquals(opaque, callback.completionHandle)
        assertNull(callback.binding)
        assertNull(callback.snapshot().attempt)
        assertNull(callback.acceptedSession)

        val emailHint = requireNotNull(parseCloudEmailSignInHint(JSONObject().put("signInHint",
            JSONObject().put("method", "email").put("email", "proved@example.com"))))
        restarted.socialAuthStore.stageEmailSession(PendingCloudEmailSignIn(
            configuration, "session-user", emailHint
        ))
        val emailRestarted = CloudPreferencesStore(context, database)
        assertNull(emailRestarted.socialAuthStore.loadHint(configuration))
        emailRestarted.socialAuthStore.completeEmailSession(configuration, "session-user")
        assertNull(emailRestarted.socialAuthStore.loadHint(configuration))
        restarted.saveCredentials(StoredCloudCredentials("session-refresh", "session-id", Long.MAX_VALUE))
        emailRestarted.socialAuthStore.completeEmailSession(configuration, "foreign-user")
        assertNull(emailRestarted.socialAuthStore.loadHint(configuration))
        emailRestarted.socialAuthStore.completeEmailSession(configuration, "session-user")
        assertEquals(emailHint, restarted.socialAuthStore.loadHint(configuration))
        restarted.socialAuthStore.stageEmailSession(PendingCloudEmailSignIn(
            configuration, "session-user", emailHint
        ))
        CloudCredentialStore(context).update { secrets ->
            secrets.copy(pendingEmailSignIn = JSONObject(requireNotNull(secrets.pendingEmailSignIn))
                .put("rememberSignIn", false).toString())
        }
        emailRestarted.socialAuthStore.completeEmailSession(configuration, "session-user")
        assertEquals(emailHint, restarted.socialAuthStore.loadHint(configuration))
        restarted.clearCredentialsRetainingSignInHint()
        val signedOut = CloudPreferencesStore(context, database)
        assertNull(signedOut.loadCredentials())
        assertNull(signedOut.socialAuthStore.loadPending())
        assertEquals(emailHint, signedOut.socialAuthStore.loadHint(configuration))
        signedOut.socialAuthStore.stageEmailSession(PendingCloudEmailSignIn(
            configuration, "session-user", emailHint
        ))
        signedOut.clearCredentials()
        signedOut.saveCredentials(StoredCloudCredentials("session-refresh", "session-id", Long.MAX_VALUE))
        restarted.socialAuthStore.completeEmailSession(configuration, "session-user")
        assertNull(restarted.socialAuthStore.loadHint(configuration))
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
            appleBrowser = null,
            originalReauthenticationBinding = originalBinding,
            mailboxReason = null,
            mailboxCodeRequested = false,
            mailboxRequestInFlight = false,
            providerCredentialObserved = false,
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
            workspaceSelection = CloudWorkspaceLinkSelection.CreateNew(name = "Spanish"),
            completedWorkspace = completedWorkspace,
            linkingWorkspace = completedWorkspace
        )
        store.socialAuthStore.savePending(pending)
        val restarted = CloudPreferencesStore(context, database)
        assertEquals(pending, restarted.socialAuthStore.loadPending())
        assertEquals(installed, restarted.loadCredentials())
        assertNull(restarted.socialAuthStore.loadHint(configuration))
        restarted.socialAuthStore.completeAcceptedSession(pending)
        assertEquals(hint.successfulHint(), store.socialAuthStore.loadHint(configuration))

        val ciphertext = File(context.filesDir, "flashcards-cloud-secrets-encrypted.bin").readBytes()
            .toString(Charsets.ISO_8859_1)
        listOf("installed-refresh", "accepted-refresh-secret", "new-verifier-secret", "recovery@example.com", "privaterelay.appleid.com")
            .forEach { secret -> assertFalse(ciphertext.contains(secret)) }
        assertFalse(context.getSharedPreferences("flashcards-cloud-secrets", Context.MODE_PRIVATE).contains("pending-social-sign-in"))

        store.socialAuthStore.savePending(pending.copy(acceptedSession = null))
        store.socialAuthStore.clearPending()
        assertEquals(hint.successfulHint(), restarted.socialAuthStore.loadHint(configuration))
        store.socialAuthStore.savePending(pending)
        CloudCredentialStore(context).update { secrets ->
            secrets.copy(pendingSocialSignIn = JSONObject(requireNotNull(secrets.pendingSocialSignIn))
                .put("rememberSignIn", false).toString())
        }
        val restored = requireNotNull(restarted.socialAuthStore.loadPending())
        assertEquals(pending, restored)
        store.socialAuthStore.completeAcceptedSession(restored)
        assertEquals(hint.successfulHint(), restarted.socialAuthStore.loadHint(configuration))
        assertEquals(installed, store.loadCredentials())
        store.clearCredentials()
        assertNull(CloudCredentialStore(context).load().pendingSocialSignIn)
        assertNull(restarted.socialAuthStore.loadHint(configuration))
    }
}
