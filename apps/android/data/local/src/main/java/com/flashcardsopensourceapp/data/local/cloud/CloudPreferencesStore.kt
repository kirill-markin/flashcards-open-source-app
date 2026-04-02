package com.flashcardsopensourceapp.data.local.cloud

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.AppLocalSettingsEntity
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
private const val installationIdKey: String = "installation-id"
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
    context: Context,
    private val database: AppDatabase
) {
    private val metadataPreferences: SharedPreferences =
        context.getSharedPreferences(cloudMetadataPreferencesName, Context.MODE_PRIVATE)
    private val securePreferences: SharedPreferences = context.getSharedPreferences(
        cloudSecretPreferencesName,
        Context.MODE_PRIVATE
    )

    private val cloudSettingsState = MutableStateFlow(loadLegacyCloudSettingsEntity().toCloudSettings())
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

    suspend fun hydrateCloudSettingsFromDatabase(): CloudSettings {
        val hydratedSettings = loadPersistedCloudSettingsEntity()
        return persistInMemoryCloudSettings(settings = hydratedSettings)
    }

    suspend fun updateCloudSettings(
        cloudState: CloudAccountState,
        linkedUserId: String?,
        linkedWorkspaceId: String?,
        linkedEmail: String?,
        activeWorkspaceId: String?
    ) {
        val updatedAtMillis = System.currentTimeMillis()
        val currentSettings = currentCloudSettingsEntity()
        val updatedSettings = currentSettings.copy(
            cloudState = cloudState.name,
            linkedUserId = linkedUserId,
            linkedWorkspaceId = linkedWorkspaceId,
            linkedEmail = linkedEmail,
            activeWorkspaceId = activeWorkspaceId,
            updatedAtMillis = updatedAtMillis
        )
        database.appLocalSettingsDao().insertSettings(updatedSettings)
        persistInMemoryCloudSettings(settings = updatedSettings)
    }

    suspend fun updateActiveWorkspaceId(activeWorkspaceId: String?) {
        val updatedAtMillis = System.currentTimeMillis()
        val currentSettings = currentCloudSettingsEntity()
        val updatedSettings = currentSettings.copy(
            activeWorkspaceId = activeWorkspaceId,
            updatedAtMillis = updatedAtMillis
        )
        database.appLocalSettingsDao().insertSettings(updatedSettings)
        persistInMemoryCloudSettings(settings = updatedSettings)
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

    suspend fun regenerateInstallationId(): String {
        // Installation identity is global per app install and must never be reused
        // after an explicit local identity reset.
        val installationId = UUID.randomUUID().toString()
        val updatedAtMillis = System.currentTimeMillis()
        val currentSettings = currentCloudSettingsEntity()
        val updatedSettings = currentSettings.copy(
            installationId = installationId,
            updatedAtMillis = updatedAtMillis
        )
        database.appLocalSettingsDao().insertSettings(updatedSettings)
        persistInMemoryCloudSettings(settings = updatedSettings)
        return installationId
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

    private fun createInstallationId(): String {
        // The first generated installation id survives user and workspace switches.
        val installationId = UUID.randomUUID().toString()
        metadataPreferences.edit(commit = true) {
            putString(installationIdKey, installationId)
        }
        return installationId
    }

    private fun currentCloudSettingsEntity(): AppLocalSettingsEntity {
        val currentSettings = cloudSettingsState.value
        return AppLocalSettingsEntity(
            settingsId = 1,
            installationId = currentSettings.installationId,
            cloudState = currentSettings.cloudState.name,
            linkedUserId = currentSettings.linkedUserId,
            linkedWorkspaceId = currentSettings.linkedWorkspaceId,
            linkedEmail = currentSettings.linkedEmail,
            activeWorkspaceId = currentSettings.activeWorkspaceId,
            updatedAtMillis = currentSettings.updatedAtMillis
        )
    }

    private suspend fun loadPersistedCloudSettingsEntity(): AppLocalSettingsEntity {
        val storedSettings = database.appLocalSettingsDao().loadSettings()
        if (storedSettings != null) {
            return storedSettings
        }

        val migratedSettings = migrateLegacyCloudSettings()
        database.appLocalSettingsDao().insertSettings(migratedSettings)
        return migratedSettings
    }

    private suspend fun migrateLegacyCloudSettings(): AppLocalSettingsEntity {
        val installationId = metadataPreferences.getString(installationIdKey, null) ?: createInstallationId()
        val activeWorkspaceId = metadataPreferences.getString(activeWorkspaceIdKey, null)
            ?: database.workspaceDao().loadAnyWorkspace()?.workspaceId
        return AppLocalSettingsEntity(
            settingsId = 1,
            installationId = installationId,
            cloudState = metadataPreferences.getString(cloudStateKey, CloudAccountState.DISCONNECTED.name)
                ?: CloudAccountState.DISCONNECTED.name,
            linkedUserId = metadataPreferences.getString(linkedUserIdKey, null),
            linkedWorkspaceId = metadataPreferences.getString(linkedWorkspaceIdKey, null),
            linkedEmail = metadataPreferences.getString(linkedEmailKey, null),
            activeWorkspaceId = activeWorkspaceId,
            updatedAtMillis = metadataPreferences.getLong(updatedAtMillisKey, 0L)
        )
    }

    private fun loadLegacyCloudSettingsEntity(): AppLocalSettingsEntity {
        val installationId = metadataPreferences.getString(installationIdKey, null) ?: createInstallationId()
        return AppLocalSettingsEntity(
            settingsId = 1,
            installationId = installationId,
            cloudState = metadataPreferences.getString(cloudStateKey, CloudAccountState.DISCONNECTED.name)
                ?: CloudAccountState.DISCONNECTED.name,
            linkedUserId = metadataPreferences.getString(linkedUserIdKey, null),
            linkedWorkspaceId = metadataPreferences.getString(linkedWorkspaceIdKey, null),
            linkedEmail = metadataPreferences.getString(linkedEmailKey, null),
            activeWorkspaceId = metadataPreferences.getString(activeWorkspaceIdKey, null),
            updatedAtMillis = metadataPreferences.getLong(updatedAtMillisKey, 0L)
        )
    }

    private fun persistInMemoryCloudSettings(settings: AppLocalSettingsEntity): CloudSettings {
        mirrorLegacyCloudSettings(settings)
        val cloudSettings = settings.toCloudSettings()
        cloudSettingsState.value = cloudSettings
        return cloudSettings
    }

    private fun mirrorLegacyCloudSettings(settings: AppLocalSettingsEntity) {
        metadataPreferences.edit(commit = true) {
            putString(installationIdKey, settings.installationId)
            putString(cloudStateKey, settings.cloudState)
            putString(linkedUserIdKey, settings.linkedUserId)
            putString(linkedWorkspaceIdKey, settings.linkedWorkspaceId)
            putString(linkedEmailKey, settings.linkedEmail)
            putString(activeWorkspaceIdKey, settings.activeWorkspaceId)
            putLong(updatedAtMillisKey, settings.updatedAtMillis)
        }
    }
}

private fun AppLocalSettingsEntity.toCloudSettings(): CloudSettings {
    return CloudSettings(
        installationId = installationId,
        cloudState = CloudAccountState.valueOf(cloudState),
        linkedUserId = linkedUserId,
        linkedWorkspaceId = linkedWorkspaceId,
        linkedEmail = linkedEmail,
        activeWorkspaceId = activeWorkspaceId,
        updatedAtMillis = updatedAtMillis
    )
}

private const val accountDeletionStatusHidden: String = "hidden"
private const val accountDeletionStatusInProgress: String = "in_progress"
private const val accountDeletionStatusFailed: String = "failed"
