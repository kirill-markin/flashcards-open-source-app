package com.flashcardsopensourceapp.data.local.cloud

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.makeCustomCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID

private const val cloudMetadataPreferencesName: String = "flashcards-cloud-metadata"
private const val cloudSecretPreferencesName: String = "flashcards-cloud-secrets"
private const val deviceIdKey: String = "device-id"
private const val cloudStateKey: String = "cloud-state"
private const val linkedUserIdKey: String = "linked-user-id"
private const val linkedWorkspaceIdKey: String = "linked-workspace-id"
private const val linkedEmailKey: String = "linked-email"
private const val activeWorkspaceIdKey: String = "active-workspace-id"
private const val updatedAtMillisKey: String = "updated-at-millis"
private const val accountDeletionStatusKey: String = "account-deletion-status"
private const val accountDeletionFailureMessageKey: String = "account-deletion-failure-message"
private const val customOriginKey: String = "custom-origin"
private const val refreshTokenKey: String = "refresh-token"
private const val idTokenKey: String = "id-token"
private const val idTokenExpiresAtMillisKey: String = "id-token-expires-at-millis"

class CloudPreferencesStore(
    context: Context
) {
    private val metadataPreferences: SharedPreferences =
        context.getSharedPreferences(cloudMetadataPreferencesName, Context.MODE_PRIVATE)
    private val securePreferences: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        cloudSecretPreferencesName,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    private val cloudSettingsState = MutableStateFlow(loadCloudSettings())
    private val accountDeletionState = MutableStateFlow(loadAccountDeletionState())
    private val serverConfigurationState = MutableStateFlow(loadServerConfiguration())

    fun observeCloudSettings(): StateFlow<CloudSettings> {
        return cloudSettingsState.asStateFlow()
    }

    fun observeServerConfiguration(): StateFlow<CloudServiceConfiguration> {
        return serverConfigurationState.asStateFlow()
    }

    fun observeAccountDeletionState(): StateFlow<AccountDeletionState> {
        return accountDeletionState.asStateFlow()
    }

    fun currentCloudSettings(): CloudSettings {
        return cloudSettingsState.value
    }

    fun currentServerConfiguration(): CloudServiceConfiguration {
        return serverConfigurationState.value
    }

    fun currentAccountDeletionState(): AccountDeletionState {
        return accountDeletionState.value
    }

    fun loadCredentials(): StoredCloudCredentials? {
        val refreshToken = securePreferences.getString(refreshTokenKey, null) ?: return null
        val idToken = securePreferences.getString(idTokenKey, null) ?: return null
        val idTokenExpiresAtMillis = securePreferences.getLong(idTokenExpiresAtMillisKey, 0L)
        if (idTokenExpiresAtMillis <= 0L) {
            return null
        }

        return StoredCloudCredentials(
            refreshToken = refreshToken,
            idToken = idToken,
            idTokenExpiresAtMillis = idTokenExpiresAtMillis
        )
    }

    fun saveCredentials(credentials: StoredCloudCredentials) {
        securePreferences.edit(commit = true) {
            putString(refreshTokenKey, credentials.refreshToken)
            putString(idTokenKey, credentials.idToken)
            putLong(idTokenExpiresAtMillisKey, credentials.idTokenExpiresAtMillis)
        }
    }

    fun clearCredentials() {
        securePreferences.edit(commit = true) {
            remove(refreshTokenKey)
            remove(idTokenKey)
            remove(idTokenExpiresAtMillisKey)
        }
    }

    fun updateIdToken(idToken: String, idTokenExpiresAtMillis: Long) {
        securePreferences.edit(commit = true) {
            putString(idTokenKey, idToken)
            putLong(idTokenExpiresAtMillisKey, idTokenExpiresAtMillis)
        }
    }

    fun updateCloudSettings(
        cloudState: CloudAccountState,
        linkedUserId: String?,
        linkedWorkspaceId: String?,
        linkedEmail: String?,
        activeWorkspaceId: String?
    ) {
        val updatedAtMillis = System.currentTimeMillis()
        metadataPreferences.edit(commit = true) {
            putString(cloudStateKey, cloudState.name)
            putString(linkedUserIdKey, linkedUserId)
            putString(linkedWorkspaceIdKey, linkedWorkspaceId)
            putString(linkedEmailKey, linkedEmail)
            putString(activeWorkspaceIdKey, activeWorkspaceId)
            putLong(updatedAtMillisKey, updatedAtMillis)
        }
        cloudSettingsState.value = loadCloudSettings()
    }

    fun updateActiveWorkspaceId(activeWorkspaceId: String?) {
        metadataPreferences.edit(commit = true) {
            putString(activeWorkspaceIdKey, activeWorkspaceId)
            putLong(updatedAtMillisKey, System.currentTimeMillis())
        }
        cloudSettingsState.value = loadCloudSettings()
    }

    fun markAccountDeletionInProgress() {
        metadataPreferences.edit(commit = true) {
            putString(accountDeletionStatusKey, accountDeletionStatusInProgress)
            remove(accountDeletionFailureMessageKey)
        }
        accountDeletionState.value = AccountDeletionState.InProgress
    }

    fun markAccountDeletionFailed(message: String) {
        metadataPreferences.edit(commit = true) {
            putString(accountDeletionStatusKey, accountDeletionStatusFailed)
            putString(accountDeletionFailureMessageKey, message)
        }
        accountDeletionState.value = AccountDeletionState.Failed(message = message)
    }

    fun clearAccountDeletionState() {
        metadataPreferences.edit(commit = true) {
            putString(accountDeletionStatusKey, accountDeletionStatusHidden)
            remove(accountDeletionFailureMessageKey)
        }
        accountDeletionState.value = AccountDeletionState.Hidden
    }

    fun regenerateDeviceId(): String {
        val deviceId = UUID.randomUUID().toString()
        metadataPreferences.edit(commit = true) {
            putString(deviceIdKey, deviceId)
            putLong(updatedAtMillisKey, System.currentTimeMillis())
        }
        cloudSettingsState.value = loadCloudSettings()
        return deviceId
    }

    fun applyCustomServer(configuration: CloudServiceConfiguration) {
        val customOrigin = requireNotNull(configuration.customOrigin) {
            "Custom server configuration must include the original origin."
        }
        metadataPreferences.edit(commit = true) {
            putString(customOriginKey, customOrigin)
        }
        serverConfigurationState.value = loadServerConfiguration()
    }

    fun resetToOfficialServer() {
        metadataPreferences.edit(commit = true) {
            remove(customOriginKey)
        }
        serverConfigurationState.value = loadServerConfiguration()
    }

    private fun loadCloudSettings(): CloudSettings {
        val deviceId = metadataPreferences.getString(deviceIdKey, null) ?: createDeviceId()
        return CloudSettings(
            deviceId = deviceId,
            cloudState = CloudAccountState.valueOf(
                metadataPreferences.getString(cloudStateKey, CloudAccountState.DISCONNECTED.name)
                    ?: CloudAccountState.DISCONNECTED.name
            ),
            linkedUserId = metadataPreferences.getString(linkedUserIdKey, null),
            linkedWorkspaceId = metadataPreferences.getString(linkedWorkspaceIdKey, null),
            linkedEmail = metadataPreferences.getString(linkedEmailKey, null),
            activeWorkspaceId = metadataPreferences.getString(activeWorkspaceIdKey, null),
            updatedAtMillis = metadataPreferences.getLong(updatedAtMillisKey, 0L)
        )
    }

    private fun loadServerConfiguration(): CloudServiceConfiguration {
        val customOrigin = metadataPreferences.getString(customOriginKey, null)
        return if (customOrigin == null) {
            makeOfficialCloudServiceConfiguration()
        } else {
            makeCustomCloudServiceConfiguration(customOrigin = customOrigin)
        }
    }

    private fun loadAccountDeletionState(): AccountDeletionState {
        return when (metadataPreferences.getString(accountDeletionStatusKey, accountDeletionStatusHidden)) {
            accountDeletionStatusInProgress -> AccountDeletionState.InProgress
            accountDeletionStatusFailed -> AccountDeletionState.Failed(
                message = metadataPreferences.getString(accountDeletionFailureMessageKey, null)
                    ?: "Account deletion failed."
            )
            else -> AccountDeletionState.Hidden
        }
    }

    private fun createDeviceId(): String {
        val deviceId = UUID.randomUUID().toString()
        metadataPreferences.edit(commit = true) {
            putString(deviceIdKey, deviceId)
        }
        return deviceId
    }
}

private const val accountDeletionStatusHidden: String = "hidden"
private const val accountDeletionStatusInProgress: String = "in_progress"
private const val accountDeletionStatusFailed: String = "failed"
