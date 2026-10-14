package com.flashcardsopensourceapp.data.local.cloud

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private const val legacyCloudSecretsName: String = "flashcards-cloud-secrets"
private const val encryptedCloudSecretsName: String = "flashcards-cloud-secrets-encrypted.bin"
private const val cloudSecretsKeyAlias: String = "flashcards-cloud-secrets-aes-gcm-v1"
private const val refreshTokenKey: String = "refresh-token"
private const val idTokenKey: String = "id-token"
private const val idTokenExpiresAtMillisKey: String = "id-token-expires-at-millis"
private const val pendingGuestUpgradeKey: String = "pending-guest-upgrade"
private const val cloudSecretsVersion: Byte = 1
private const val cloudSecretsIvSize: Int = 12
private const val cloudSecretsTagSize: Int = 128
private val cloudSecretsLock = Any()
private val cloudSecretsAssociatedData: ByteArray =
    "flashcards-cloud-secrets-encrypted:v1".toByteArray(Charsets.UTF_8)

@Serializable
internal data class CloudCredentialSecrets(
    val refreshToken: String?,
    val idToken: String?,
    val idTokenExpiresAtMillis: Long?,
    val pendingGuestUpgrade: String?
)

internal class CloudCredentialStore(context: Context) {
    private val legacyPreferences: SharedPreferences = context.getSharedPreferences(
        legacyCloudSecretsName,
        Context.MODE_PRIVATE
    )
    private val file = File(context.filesDir, encryptedCloudSecretsName)
    private val storage = AtomicFile(file)

    fun load(): CloudCredentialSecrets = synchronized(cloudSecretsLock) {
        loadLocked()
    }

    fun update(transform: (CloudCredentialSecrets) -> CloudCredentialSecrets) {
        synchronized(cloudSecretsLock) {
            persistLocked(secrets = transform(loadLocked()))
        }
    }

    fun clear() {
        synchronized(cloudSecretsLock) {
            persistLocked(
                secrets = CloudCredentialSecrets(
                    refreshToken = null,
                    idToken = null,
                    idTokenExpiresAtMillis = null,
                    pendingGuestUpgrade = null
                )
            )
            clearLegacySecrets()
        }
    }

    private fun loadLocked(): CloudCredentialSecrets {
        try {
            val secrets = if (file.exists() || File(file.path + ".bak").exists()) {
                decrypt(payload = storage.openRead().use { stream -> stream.readBytes() })
            } else {
                val legacySecrets = loadLegacySecrets()
                persistLocked(secrets = legacySecrets)
                legacySecrets
            }
            // A process death between these commits leaves the encrypted record authoritative.
            clearLegacySecrets()
            return secrets
        } catch (error: IOException) {
            throw IllegalStateException(
                "Cloud credential storage could not be read or migrated. Stored data was retained; retry after restarting the app.",
                error
            )
        } catch (error: GeneralSecurityException) {
            throw IllegalStateException(
                "Cloud credentials could not be decrypted with this device's Android Keystore key. Stored data was retained.",
                error
            )
        } catch (_: SerializationException) {
            // Serialization exceptions can include the plaintext input, so do not expose their cause.
            throw IllegalStateException("Cloud credential storage has invalid serialized data. Stored data was retained.")
        }
    }

    private fun loadLegacySecrets(): CloudCredentialSecrets {
        return CloudCredentialSecrets(
            refreshToken = legacyPreferences.getString(refreshTokenKey, null),
            idToken = legacyPreferences.getString(idTokenKey, null),
            idTokenExpiresAtMillis = if (legacyPreferences.contains(idTokenExpiresAtMillisKey)) {
                legacyPreferences.getLong(idTokenExpiresAtMillisKey, 0L)
            } else {
                null
            },
            pendingGuestUpgrade = legacyPreferences.getString(pendingGuestUpgradeKey, null)
        )
    }

    private fun clearLegacySecrets() {
        val keys = listOf(refreshTokenKey, idTokenKey, idTokenExpiresAtMillisKey, pendingGuestUpgradeKey)
        val editor = legacyPreferences.edit()
        keys.forEach(editor::remove)
        if (editor.commit().not()) {
            throw IOException("The migrated plaintext cloud secrets could not be removed from disk.")
        }
    }

    private fun persistLocked(secrets: CloudCredentialSecrets) {
        val payload: ByteArray = try {
            encrypt(secrets = secrets)
        } catch (error: GeneralSecurityException) {
            throw IllegalStateException("Cloud credentials could not be encrypted with Android Keystore. Stored data was retained.", error)
        }
        val stream = storage.startWrite()
        try {
            stream.write(payload)
            stream.fd.sync()
        } catch (error: IOException) {
            storage.failWrite(stream)
            throw IOException("Encrypted cloud credentials could not be written to disk.", error)
        }
        storage.finishWrite(stream)
        // AtomicFile reports finalization errors through logging; verify before deleting any plaintext.
        val persistedPayload = storage.openRead().use { persistedStream -> persistedStream.readBytes() }
        if (persistedPayload.contentEquals(payload).not()) {
            throw IOException("Encrypted cloud credential storage did not commit the complete payload.")
        }
    }

    private fun encrypt(secrets: CloudCredentialSecrets): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
        cipher.updateAAD(cloudSecretsAssociatedData)
        check(cipher.iv.size == cloudSecretsIvSize) { "Android Keystore returned an unexpected AES-GCM IV size." }
        val plaintext = Json.encodeToString(secrets).toByteArray(Charsets.UTF_8)
        return byteArrayOf(cloudSecretsVersion) + cipher.iv + cipher.doFinal(plaintext)
    }

    private fun decrypt(payload: ByteArray): CloudCredentialSecrets {
        check(payload.size >= 1 + cloudSecretsIvSize + cloudSecretsTagSize / 8) {
            "Encrypted cloud credential storage is truncated. Stored data was retained."
        }
        check(payload[0] == cloudSecretsVersion) {
            "Encrypted cloud credential storage has an unsupported version. Stored data was retained."
        }
        val key = requireNotNull(loadKey()) {
            "The Android Keystore key for stored cloud credentials is missing. Stored data was retained."
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            key,
            GCMParameterSpec(cloudSecretsTagSize, payload.copyOfRange(1, 1 + cloudSecretsIvSize))
        )
        cipher.updateAAD(cloudSecretsAssociatedData)
        val plaintext = cipher.doFinal(payload.copyOfRange(1 + cloudSecretsIvSize, payload.size))
        return Json.decodeFromString<CloudCredentialSecrets>(plaintext.toString(Charsets.UTF_8))
    }

    private fun loadKey(): SecretKey? {
        val keyStore = KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)
        val entry = keyStore.getEntry(cloudSecretsKeyAlias, null) ?: return null
        check(entry is KeyStore.SecretKeyEntry) { "Cloud credential Keystore entry is not a secret key." }
        return entry.secretKey
    }

    private fun encryptionKey(): SecretKey {
        loadKey()?.let { key -> return key }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                cloudSecretsKeyAlias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }
}
