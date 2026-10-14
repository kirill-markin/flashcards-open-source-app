package com.flashcardsopensourceapp.data.local.ai.store

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
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private const val legacyGuestSessionsName: String = "flashcards-ai-chat-guest-session"
private const val encryptedGuestSessionsName: String = "flashcards-ai-chat-guest-session-encrypted.bin"
private const val guestSessionsKeyAlias: String = "flashcards-ai-chat-guest-session-aes-gcm-v1"
private const val guestSessionsVersion: Byte = 1
private const val guestSessionsIvSize: Int = 12
private const val guestSessionsTagSize: Int = 128
internal val guestSessionsLock = Any()
private val guestSessionsAssociatedData: ByteArray =
    "flashcards-ai-chat-guest-session-encrypted:v1".toByteArray(Charsets.UTF_8)

class GuestAiSessionStorageException(message: String, cause: Throwable?) : IllegalStateException(message, cause)

internal class GuestAiSessionStorage(context: Context) {
    private val legacyPreferences: SharedPreferences = context.getSharedPreferences(
        legacyGuestSessionsName,
        Context.MODE_PRIVATE
    )
    private val file = File(context.filesDir, encryptedGuestSessionsName)
    private val storage = AtomicFile(file)

    fun load(): Map<String, String> = synchronized(guestSessionsLock) {
        loadLocked()
    }

    fun save(secrets: Map<String, String>) {
        synchronized(guestSessionsLock) {
            try {
                persistLocked(secrets = secrets)
            } catch (error: IOException) {
                throw GuestAiSessionStorageException("Guest sessions could not be committed to disk. Stored data was retained.", error)
            }
        }
    }

    fun clear() {
        synchronized(guestSessionsLock) {
            try {
                persistLocked(secrets = emptyMap())
                clearLegacySecrets()
            } catch (error: IOException) {
                throw GuestAiSessionStorageException("Guest session reset could not be committed to disk. Retry the reset.", error)
            }
        }
    }

    private fun loadLocked(): Map<String, String> {
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
            throw GuestAiSessionStorageException(
                "Guest session storage could not be read or migrated. Stored data was retained; retry after restarting the app.",
                error
            )
        } catch (error: GeneralSecurityException) {
            throw GuestAiSessionStorageException(
                "Guest sessions could not be decrypted with this device's Android Keystore key. Stored data was retained.",
                error
            )
        } catch (_: SerializationException) {
            // Serialization exceptions can include the plaintext input, so do not expose their cause.
            throw GuestAiSessionStorageException("Guest session storage has invalid serialized data. Stored data was retained.", null)
        }
    }

    private fun loadLegacySecrets(): Map<String, String> {
        return legacyPreferences.all.entries.mapNotNull { entry ->
            val value = entry.value as? String
            if (value == null) {
                if (entry.key == "guest-session-creation-idempotency-key") {
                    throw GuestAiSessionStorageException("The legacy guest creation recovery key has an invalid type. Stored data was retained.", null)
                }
                return@mapNotNull null
            }
            entry.key to value
        }.toMap()
    }

    private fun clearLegacySecrets() {
        if (legacyPreferences.edit().clear().commit().not()) {
            throw IOException("The migrated plaintext guest sessions could not be removed from disk.")
        }
    }

    private fun persistLocked(secrets: Map<String, String>) {
        val payload: ByteArray = try {
            encrypt(secrets = secrets)
        } catch (error: GeneralSecurityException) {
            throw GuestAiSessionStorageException("Guest sessions could not be encrypted with Android Keystore. Stored data was retained.", error)
        }
        val stream = storage.startWrite()
        try {
            stream.write(payload)
            stream.fd.sync()
        } catch (error: IOException) {
            storage.failWrite(stream)
            throw IOException("Encrypted guest sessions could not be written to disk.", error)
        }
        storage.finishWrite(stream)
        // AtomicFile reports finalization errors through logging; verify before deleting any plaintext.
        val persistedPayload = storage.openRead().use { persistedStream -> persistedStream.readBytes() }
        if (persistedPayload.contentEquals(payload).not()) {
            throw IOException("Encrypted guest session storage did not commit the complete payload.")
        }
    }

    private fun encrypt(secrets: Map<String, String>): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
        cipher.updateAAD(guestSessionsAssociatedData)
        if (cipher.iv.size != guestSessionsIvSize) {
            throw GuestAiSessionStorageException("Android Keystore returned an unexpected AES-GCM IV size. Stored data was retained.", null)
        }
        val plaintext = Json.encodeToString(secrets).toByteArray(Charsets.UTF_8)
        return byteArrayOf(guestSessionsVersion) + cipher.iv + cipher.doFinal(plaintext)
    }

    private fun decrypt(payload: ByteArray): Map<String, String> {
        if (payload.size < 1 + guestSessionsIvSize + guestSessionsTagSize / 8) {
            throw GuestAiSessionStorageException("Encrypted guest session storage is truncated. Stored data was retained.", null)
        }
        if (payload[0] != guestSessionsVersion) {
            throw GuestAiSessionStorageException("Encrypted guest session storage has an unsupported version. Stored data was retained.", null)
        }
        val key = loadKey() ?: throw GuestAiSessionStorageException(
            "The Android Keystore key for stored guest sessions is missing. Stored data was retained.",
            null
        )
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            key,
            GCMParameterSpec(guestSessionsTagSize, payload.copyOfRange(1, 1 + guestSessionsIvSize))
        )
        cipher.updateAAD(guestSessionsAssociatedData)
        val plaintext = cipher.doFinal(payload.copyOfRange(1 + guestSessionsIvSize, payload.size))
        return Json.decodeFromString<Map<String, String>>(plaintext.toString(Charsets.UTF_8))
    }

    private fun loadKey(): SecretKey? {
        val keyStore = KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)
        val entry = keyStore.getEntry(guestSessionsKeyAlias, null) ?: return null
        if (entry !is KeyStore.SecretKeyEntry) {
            throw GuestAiSessionStorageException("Guest session Keystore entry is not a secret key. Stored data was retained.", null)
        }
        return entry.secretKey
    }

    private fun encryptionKey(): SecretKey {
        loadKey()?.let { key -> return key }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                guestSessionsKeyAlias,
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
