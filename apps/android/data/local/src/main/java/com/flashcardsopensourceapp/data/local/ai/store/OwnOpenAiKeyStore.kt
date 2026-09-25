package com.flashcardsopensourceapp.data.local.ai.store

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.flashcardsopensourceapp.data.local.ai.diagnostics.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.model.ai.OwnOpenAiKeySettings
import com.flashcardsopensourceapp.data.local.model.ai.OwnOpenAiKeyStorageStatus
import com.flashcardsopensourceapp.data.local.model.ai.hasActiveOwnOpenAiKey
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.ProviderException
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

// Both files are excluded from backup and device transfer in app/src/main/res/xml/data_extraction_rules.xml.
private const val ownOpenAiKeySwitchPreferencesName: String = "flashcards-ai-own-openai-key-switch"
private const val ownOpenAiKeyEnabledKey: String = "enabled"
private const val ownOpenAiKeyPreferencesName: String = "flashcards-ai-own-openai-key"
private const val ownOpenAiKeyApiKeyKey: String = "api-key"

/**
 * Keeps the person's own OpenAI key encrypted on this device. It leaves the device only as the
 * `x-openai-api-key` header on AI requests while it is turned on.
 *
 * The switch lives in plain preferences, so the encrypted file and its Keystore key are opened only
 * while the switch is on, and only off the main thread. An encrypted file that cannot be opened, read
 * or written is deleted, and the key counts as absent.
 */
class OwnOpenAiKeyStore(
    context: Context,
    private val scope: CoroutineScope
) {
    private val applicationContext: Context = context.applicationContext
    private val switchPreferences: SharedPreferences = applicationContext.getSharedPreferences(
        ownOpenAiKeySwitchPreferencesName,
        Context.MODE_PRIVATE
    )
    private val encryptedStorageMutex = Mutex()
    /** Guarded by [encryptedStorageMutex]. */
    private var encryptedPreferences: SharedPreferences? = null
    /** Bumped by [clear], so a key write queued before it never lands after it. */
    private val clearGeneration = AtomicLong(0L)
    private val settingsState = MutableStateFlow(
        value = OwnOpenAiKeySettings(
            isEnabled = switchPreferences.getBoolean(ownOpenAiKeyEnabledKey, false),
            apiKey = "",
            storageStatus = OwnOpenAiKeyStorageStatus.NOT_LOADED
        )
    )

    init {
        loadApiKeyInBackgroundIfNeeded()
    }

    fun observeSettings(): StateFlow<OwnOpenAiKeySettings> {
        return settingsState.asStateFlow()
    }

    /** Reads memory only, so it stays false until the stored key has been loaded. */
    fun isActive(): Boolean {
        return hasActiveOwnOpenAiKey(settings = settingsState.value)
    }

    /** The key to send, or null while the setting is off or the field is empty. */
    suspend fun activeApiKeyOrNull(): String? {
        loadApiKeyIfNeeded()
        val settings = settingsState.value
        if (hasActiveOwnOpenAiKey(settings = settings).not()) {
            return null
        }
        return settings.apiKey
    }

    fun updateEnabled(isEnabled: Boolean) {
        switchPreferences.edit {
            putBoolean(ownOpenAiKeyEnabledKey, isEnabled)
        }
        settingsState.update { settings ->
            settings.copy(isEnabled = isEnabled)
        }
        loadApiKeyInBackgroundIfNeeded()
    }

    /** Shows the new key at once and writes the encrypted file in the background. */
    fun updateApiKey(apiKey: String) {
        val headerSafeApiKey = headerSafeOwnOpenAiKey(apiKey = apiKey)
        settingsState.update { settings ->
            settings.copy(apiKey = headerSafeApiKey)
        }
        val generation = clearGeneration.get()
        scope.launch {
            encryptedStorageMutex.withLock {
                if (generation != clearGeneration.get()) {
                    return@withLock
                }
                withContext(Dispatchers.IO) {
                    // The latest typed key, so writes that finish out of order still end on it.
                    val latestApiKey = settingsState.value.apiKey
                    runEncryptedStorageOperationLocked { preferences ->
                        val isCommitted = preferences.edit()
                            .putString(ownOpenAiKeyApiKeyKey, latestApiKey)
                            .commit()
                        if (isCommitted.not()) {
                            throw IOException("The own OpenAI key was not written to disk.")
                        }
                    } ?: return@withContext
                    settingsState.update { settings ->
                        settings.copy(storageStatus = OwnOpenAiKeyStorageStatus.LOADED)
                    }
                }
            }
        }
    }

    /** Removes the switch and the key, so the next person on this install never runs on this key. */
    suspend fun clear() {
        clearGeneration.incrementAndGet()
        encryptedStorageMutex.withLock {
            withContext(Dispatchers.IO) {
                switchPreferences.edit(commit = true) {
                    remove(ownOpenAiKeyEnabledKey)
                }
                deleteEncryptedPreferencesLocked()
                settingsState.value = OwnOpenAiKeySettings(
                    isEnabled = false,
                    apiKey = "",
                    storageStatus = OwnOpenAiKeyStorageStatus.NOT_LOADED
                )
            }
        }
    }

    private fun loadApiKeyInBackgroundIfNeeded() {
        if (needsApiKeyLoad(settings = settingsState.value).not()) {
            return
        }
        scope.launch {
            loadApiKeyIfNeeded()
        }
    }

    private suspend fun loadApiKeyIfNeeded() {
        if (needsApiKeyLoad(settings = settingsState.value).not()) {
            return
        }
        encryptedStorageMutex.withLock {
            if (needsApiKeyLoad(settings = settingsState.value).not()) {
                return@withLock
            }
            withContext(Dispatchers.IO) {
                val storedApiKey = runEncryptedStorageOperationLocked { preferences ->
                    preferences.getString(ownOpenAiKeyApiKeyKey, null).orEmpty()
                } ?: return@withContext
                settingsState.update { settings ->
                    settings.copy(
                        apiKey = storedApiKey,
                        storageStatus = OwnOpenAiKeyStorageStatus.LOADED
                    )
                }
            }
        }
    }

    /**
     * Runs [operation] on the encrypted file. Returns null when the file or its Keystore key cannot be
     * used; the file is then deleted and the key counts as absent, which the key screen reports.
     */
    private fun <T> runEncryptedStorageOperationLocked(operation: (SharedPreferences) -> T): T? {
        val failure: Exception = try {
            return operation(encryptedPreferencesLocked())
        } catch (error: GeneralSecurityException) {
            error
        } catch (error: IOException) {
            error
        } catch (error: SecurityException) {
            // EncryptedSharedPreferences reports a value it cannot decrypt or encrypt this way.
            error
        } catch (error: ProviderException) {
            // Android Keystore reports a Keystore key it cannot create or use this way, and Tink lets
            // it escape EncryptedSharedPreferences.create() after its single retry.
            error
        }
        AiChatDiagnosticsLogger.warn(
            event = "own_openai_key_storage_unreadable",
            fields = listOf("errorType" to failure::class.java.name)
        )
        deleteEncryptedPreferencesLocked()
        settingsState.update { settings ->
            settings.copy(
                apiKey = "",
                storageStatus = OwnOpenAiKeyStorageStatus.UNREADABLE
            )
        }
        return null
    }

    private fun encryptedPreferencesLocked(): SharedPreferences {
        return encryptedPreferences ?: createOwnOpenAiKeyPreferences(context = applicationContext).also { created ->
            encryptedPreferences = created
        }
    }

    private fun deleteEncryptedPreferencesLocked() {
        encryptedPreferences = null
        if (applicationContext.deleteSharedPreferences(ownOpenAiKeyPreferencesName).not()) {
            AiChatDiagnosticsLogger.warn(
                event = "own_openai_key_storage_delete_failed",
                fields = listOf("preferencesName" to ownOpenAiKeyPreferencesName)
            )
        }
    }
}

private fun needsApiKeyLoad(settings: OwnOpenAiKeySettings): Boolean {
    return settings.isEnabled && settings.storageStatus == OwnOpenAiKeyStorageStatus.NOT_LOADED
}

/**
 * OpenAI keys are printable ASCII without spaces. Dropping everything else keeps a pasted line break
 * out of the stored key and keeps the value a legal header, because OkHttp rejects an illegal header
 * value with an exception whose message quotes the value.
 */
private fun headerSafeOwnOpenAiKey(apiKey: String): String {
    return apiKey.filter { character -> character in '!'..'~' }
}

// security-crypto 1.1.0 deprecates these APIs without a replacement in AndroidX; they remain the
// supported way to keep a secret in app-private storage encrypted by a Keystore key.
@Suppress("DEPRECATION")
private fun createOwnOpenAiKeyPreferences(context: Context): SharedPreferences {
    val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
    return EncryptedSharedPreferences.create(
        context,
        ownOpenAiKeyPreferencesName,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )
}
