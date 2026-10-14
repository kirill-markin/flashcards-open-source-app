package com.flashcardsopensourceapp.data.local.migrations

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.CloudCredentialStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.support.clearLocalDatabaseSharedPreferences
import com.flashcardsopensourceapp.data.local.support.createInMemoryAppDatabase
import kotlinx.coroutines.runBlocking
import java.io.File
import java.security.KeyStore
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CloudPreferencesStoreMigrationContractTest {
    private lateinit var context: Context
    private lateinit var database: AppDatabase

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        clearLocalDatabaseSharedPreferences(context = context)
        database = createInMemoryAppDatabase(context = context)
    }

    @After
    fun tearDown() {
        if (::database.isInitialized) {
            database.close()
        }
        if (::context.isInitialized) {
            clearLocalDatabaseSharedPreferences(context = context)
        }
    }

    @Test
    fun cloudPreferencesStoreMigratesLegacyIdentityFromPreferencesIntoDatabaseSettings() = runBlocking {
        database.close()
        clearLocalDatabaseSharedPreferences(context = context)

        val legacyPreferences = context.getSharedPreferences("flashcards-cloud-metadata", Context.MODE_PRIVATE)
        legacyPreferences.edit()
            .putString("installation-id", "legacy-installation-id")
            .putString("cloud-state", "LINKED")
            .putString("linked-user-id", "legacy-user")
            .putString("linked-workspace-id", "legacy-workspace")
            .putString("linked-email", "legacy@example.com")
            .putString("active-workspace-id", "legacy-workspace")
            .putLong("updated-at-millis", 456L)
            .commit()

        database = createInMemoryAppDatabase(context = context)
        val migratedStore = CloudPreferencesStore(context = context, database = database)
        migratedStore.hydrateCloudSettingsFromDatabase()

        val migratedSettings = migratedStore.currentCloudSettings()
        val storedSettings = requireNotNull(database.appLocalSettingsDao().loadSettings()) {
            "Expected app_local_settings after legacy migration."
        }

        assertEquals("legacy-installation-id", migratedSettings.installationId)
        assertEquals("legacy-workspace", migratedSettings.activeWorkspaceId)
        assertEquals("legacy-installation-id", storedSettings.installationId)
        assertEquals("LINKED", storedSettings.cloudState)
        assertEquals("legacy-user", storedSettings.linkedUserId)
        assertEquals("legacy-workspace", storedSettings.linkedWorkspaceId)
        assertEquals("legacy@example.com", storedSettings.linkedEmail)
        assertEquals("legacy-workspace", storedSettings.activeWorkspaceId)
        assertEquals(456L, storedSettings.updatedAtMillis)
    }

    @Test
    fun credentialMigrationPreservesSessionsAndPendingUpgradeAcrossRestart() {
        seedLegacyCredentials()
        val store = CloudPreferencesStore(context = context, database = database)

        assertEquals("legacy-refresh-secret", store.loadCredentials()?.refreshToken)
        assertEquals("legacy-id-secret", store.loadCredentials()?.idToken)
        assertEquals(Long.MAX_VALUE, store.loadCredentials()?.idTokenExpiresAtMillis)
        assertEquals("upgrade-refresh-secret", store.loadPendingGuestUpgrade()?.credentials?.refreshToken)
        assertEquals("upgrade-guest-secret", store.loadPendingGuestUpgrade()?.guestSession?.guestToken)
        assertEquals(legacyPendingUpgradeJson, CloudCredentialStore(context = context).load().pendingGuestUpgrade)
        assertTrue(legacySecrets().all.keys.none { key -> key in legacyCredentialKeys })
        assertEquals("keep-local-data", legacySecrets().getString("unrelated-value", null))
        val encryptedText = encryptedFile().readBytes().toString(Charsets.ISO_8859_1)
        listOf("legacy-refresh-secret", "legacy-id-secret", "upgrade-refresh-secret", "upgrade-guest-secret").forEach { secret ->
            assertFalse(encryptedText.contains(secret))
        }
        assertFalse(File(encryptedFile().path + ".new").exists())
        assertFalse(File(encryptedFile().path + ".bak").exists())

        store.updateIdToken(idToken = "renewed-id-secret", idTokenExpiresAtMillis = 12345L)
        val restartedStore = CloudPreferencesStore(context = context, database = database)
        assertEquals("legacy-refresh-secret", restartedStore.loadCredentials()?.refreshToken)
        assertEquals("renewed-id-secret", restartedStore.loadCredentials()?.idToken)
        assertEquals(12345L, restartedStore.loadCredentials()?.idTokenExpiresAtMillis)
        assertEquals("upgrade-guest-secret", restartedStore.loadPendingGuestUpgrade()?.guestSession?.guestToken)
        assertEquals(legacyPendingUpgradeJson, CloudCredentialStore(context = context).load().pendingGuestUpgrade)

        restartedStore.clearPendingGuestUpgrade()
        assertNull(store.loadPendingGuestUpgrade())
        assertEquals("legacy-refresh-secret", store.loadCredentials()?.refreshToken)
        val installationId = store.currentCloudSettings().installationId
        restartedStore.clearCredentials()
        assertNull(store.loadCredentials())
        assertEquals(installationId, store.currentCloudSettings().installationId)
        assertEquals("keep-local-data", legacySecrets().getString("unrelated-value", null))
    }

    @Test
    fun interruptedMigrationAndAtomicWriteKeepCommittedCredentialsAuthoritative() {
        seedLegacyCredentials()
        val store = CloudPreferencesStore(context = context, database = database)
        store.updateIdToken(idToken = "committed-id-secret", idTokenExpiresAtMillis = 12345L)
        seedLegacyCredentials()
        File(encryptedFile().path + ".new").writeBytes(byteArrayOf(1, 2, 3))

        val restartedStore = CloudPreferencesStore(context = context, database = database)
        assertEquals("committed-id-secret", restartedStore.loadCredentials()?.idToken)
        assertEquals("upgrade-guest-secret", restartedStore.loadPendingGuestUpgrade()?.guestSession?.guestToken)
        assertEquals(legacyPendingUpgradeJson, CloudCredentialStore(context = context).load().pendingGuestUpgrade)
        assertTrue(legacySecrets().all.keys.none { key -> key in legacyCredentialKeys })
        assertFalse(File(encryptedFile().path + ".new").exists())
    }

    @Test
    fun failedMigrationRetainsAllPlaintextSecretsForRetry() {
        seedLegacyCredentials()
        val stagingDirectory = File(encryptedFile().path + ".new")
        assertTrue(stagingDirectory.mkdir())
        try {
            val store = CloudPreferencesStore(context = context, database = database)
            assertThrows(IllegalStateException::class.java) { store.loadCredentials() }
            assertEquals("legacy-refresh-secret", legacySecrets().getString("refresh-token", null))
            assertEquals("legacy-id-secret", legacySecrets().getString("id-token", null))
            assertEquals(Long.MAX_VALUE, legacySecrets().getLong("id-token-expires-at-millis", 0L))
            assertEquals(legacyPendingUpgradeJson, legacySecrets().getString("pending-guest-upgrade", null))
            assertFalse(encryptedFile().exists())
        } finally {
            stagingDirectory.delete()
        }
        assertEquals(
            "legacy-refresh-secret",
            CloudPreferencesStore(context = context, database = database).loadCredentials()?.refreshToken
        )
    }

    @Test
    fun ciphertextTamperingFailsExplicitlyWithoutDeletingCredentialsOrLegacyRecovery() {
        seedLegacyCredentials()
        val store = CloudPreferencesStore(context = context, database = database)
        store.loadCredentials()
        seedLegacyCredentials()
        val tamperedPayload = encryptedFile().readBytes()
        tamperedPayload[tamperedPayload.lastIndex] = (tamperedPayload.last().toInt() xor 1).toByte()
        encryptedFile().writeBytes(tamperedPayload)

        val error = assertThrows(IllegalStateException::class.java) { store.loadCredentials() }
        assertTrue(error.message?.contains("could not be decrypted") == true)
        assertArrayEquals(tamperedPayload, encryptedFile().readBytes())
        assertEquals(legacyPendingUpgradeJson, legacySecrets().getString("pending-guest-upgrade", null))

        store.clearCredentials()
        assertNull(store.loadCredentials())
        assertNull(store.loadPendingGuestUpgrade())
        assertEquals("keep-local-data", legacySecrets().getString("unrelated-value", null))
    }

    @Test
    fun missingKeystoreKeyRetainsEncryptedDataUntilExplicitCredentialClear() {
        seedLegacyCredentials()
        val store = CloudPreferencesStore(context = context, database = database)
        store.loadCredentials()
        val originalPayload = encryptedFile().readBytes()
        val keyStore = KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)
        keyStore.deleteEntry("flashcards-cloud-secrets-aes-gcm-v1")

        val error = assertThrows(IllegalArgumentException::class.java) { store.loadCredentials() }
        assertTrue(error.message?.contains("Keystore key") == true)
        assertArrayEquals(originalPayload, encryptedFile().readBytes())
        assertFalse(keyStore.containsAlias("flashcards-cloud-secrets-aes-gcm-v1"))

        store.clearCredentials()
        assertNull(store.loadCredentials())
        assertNull(store.loadPendingGuestUpgrade())
        assertEquals("keep-local-data", legacySecrets().getString("unrelated-value", null))
    }

    private fun seedLegacyCredentials() {
        assertTrue(
            legacySecrets().edit()
                .putString("refresh-token", "legacy-refresh-secret")
                .putString("id-token", "legacy-id-secret")
                .putLong("id-token-expires-at-millis", Long.MAX_VALUE)
                .putString("pending-guest-upgrade", legacyPendingUpgradeJson)
                .putString("unrelated-value", "keep-local-data")
                .commit()
        )
    }

    private fun legacySecrets(): android.content.SharedPreferences {
        return context.getSharedPreferences("flashcards-cloud-secrets", Context.MODE_PRIVATE)
    }

    private fun encryptedFile(): File {
        return File(context.filesDir, "flashcards-cloud-secrets-encrypted.bin")
    }
}

private val legacyCredentialKeys = setOf("refresh-token", "id-token", "id-token-expires-at-millis", "pending-guest-upgrade")
private val legacyPendingUpgradeJson: String = """
    {
      "configuration": {
        "mode": "OFFICIAL", "customOrigin": null,
        "apiBaseUrl": "https://api.flashcards-open-source-app.com/v1",
        "authBaseUrl": "https://auth.flashcards-open-source-app.com"
      },
      "credentials": {
        "refreshToken": "upgrade-refresh-secret", "idToken": "upgrade-id-secret", "idTokenExpiresAtMillis": 12345
      },
      "accountSnapshot": {"userId": "linked-user", "email": "user@example.com", "workspaces": []},
      "guestSession": {
        "guestToken": "upgrade-guest-secret", "userId": "guest-user", "workspaceId": "guest-workspace",
        "configurationMode": "OFFICIAL", "apiBaseUrl": "https://api.flashcards-open-source-app.com/v1"
      },
      "guestUpgradeMode": "BOUND",
      "selection": {"type": "existing", "workspaceId": "guest-workspace"},
      "completion": null
    }
""".trimIndent()
