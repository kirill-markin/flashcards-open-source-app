package com.flashcardsopensourceapp.data.local.cloud

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.AppLocalSettingsEntity
import com.flashcardsopensourceapp.data.local.cloud.wire.putNullableString
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudBoolean
import com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlement
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeCompletion
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeDroppedEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeDroppedEntityType
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeReconciliation
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.makeCustomCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferences
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferencesUpdate
import com.flashcardsopensourceapp.data.local.model.sync.SavedAppLocale
import com.flashcardsopensourceapp.data.local.model.sync.defaultAccentColor
import com.flashcardsopensourceapp.data.local.model.sync.defaultAccountPreferences
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.util.UUID
import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.coroutineContext

private const val cloudMetadataPreferencesName: String = "flashcards-cloud-metadata"
private const val installationIdKey: String = "installation-id"
private const val cloudStateKey: String = "cloud-state"
private const val linkedUserIdKey: String = "linked-user-id"
private const val linkedWorkspaceIdKey: String = "linked-workspace-id"
private const val linkedEmailKey: String = "linked-email"
private const val activeWorkspaceIdKey: String = "active-workspace-id"
private const val updatedAtMillisKey: String = "updated-at-millis"
private const val accountDeletionStatusKey: String = "account-deletion-status"
private const val accountDeletionFailureMessageKey: String = "account-deletion-failure-message"
private const val accountDeletionFailureReportIdKey: String = "account-deletion-failure-report-id"
private const val customOriginKey: String = "custom-origin"
private const val cloudCredentialRecoveryStateKey: String = "cloud-credential-recovery-state"
private const val savedAppLocaleUserIdKey: String = "saved-app-locale-user-id"
private const val savedAppLocaleKey: String = "saved-app-locale"
private const val pendingGuestUpgradeLocalOutboxBlockReason: String =
    "Guest upgrade recovery is pending. Wait for account linking recovery to finish before changing cards."

private object LocalOutboxMutationContextKey : CoroutineContext.Key<LocalOutboxMutationContextElement>

private class LocalOutboxMutationContextElement :
    AbstractCoroutineContextElement(LocalOutboxMutationContextKey)

private fun completedUnitSignal(): CompletableDeferred<Unit> {
    val signal: CompletableDeferred<Unit> = CompletableDeferred()
    signal.complete(Unit)
    return signal
}

class CloudPreferencesStore(
    context: Context,
    private val database: AppDatabase
) {
    private val metadataPreferences: SharedPreferences =
        context.getSharedPreferences(cloudMetadataPreferencesName, Context.MODE_PRIVATE)
    private val credentialStore = CloudCredentialStore(context = context)
    internal val socialAuthStore = CloudSocialAuthStore(credentialStore = credentialStore)
    internal val accountMethodStore = CloudAccountMethodStore(credentialStore)

    private val cloudSettingsState = MutableStateFlow(loadLegacyCloudSettingsEntity().toCloudSettings())
    private val accountPreferencesStore = CloudAccountPreferencesStore(metadataPreferences = metadataPreferences)
    private val entitlementStore = CloudEntitlementStore(metadataPreferences = metadataPreferences)
    private val accountDeletionState = MutableStateFlow(loadAccountDeletionState())
    private val serverConfigurationState = MutableStateFlow(loadServerConfiguration())
    private val cloudCredentialRecoveryStateJson = MutableStateFlow(loadCloudCredentialRecoveryStateJsonFromPreferences())
    private val firstReviewOnboardingDeliveryGate = Mutex()
    private val localOutboxWriteGate = Mutex()
    private var localOutboxWriteBlockReason: String? = null
    private var activeLocalOutboxMutationTransactions: Int = 0
    private var localOutboxMutationTransactionsDrained: CompletableDeferred<Unit> = completedUnitSignal()

    fun observeCloudSettings(): StateFlow<CloudSettings> {
        return cloudSettingsState.asStateFlow()
    }

    fun observeAccountPreferences(): StateFlow<AccountPreferences> {
        return accountPreferencesStore.observeAccountPreferences()
    }

    fun observeServerConfiguration(): StateFlow<CloudServiceConfiguration> {
        return serverConfigurationState.asStateFlow()
    }

    fun observeEntitlement(): StateFlow<CloudEntitlement?> {
        return entitlementStore.observeEntitlement()
    }

    fun saveEntitlement(entitlement: CloudEntitlement) {
        entitlementStore.saveEntitlement(entitlement = entitlement)
    }

    fun currentEntitlementReceiptRevision(): Long {
        return entitlementStore.currentReceiptRevision()
    }

    fun observeAccountDeletionState(): StateFlow<AccountDeletionState> {
        return accountDeletionState.asStateFlow()
    }

    fun observeCloudCredentialRecoveryState(): Flow<CloudCredentialRecoveryState?> {
        return cloudCredentialRecoveryStateJson.map { rawValue ->
            decodeCloudCredentialRecoveryStateFromRawValue(rawValue = rawValue)
        }
    }

    fun currentCloudSettings(): CloudSettings {
        return cloudSettingsState.value
    }

    fun currentAccountPreferences(): AccountPreferences {
        return accountPreferencesStore.currentAccountPreferences()
    }

    fun currentServerConfiguration(): CloudServiceConfiguration {
        return serverConfigurationState.value
    }

    fun currentAccountDeletionState(): AccountDeletionState {
        return accountDeletionState.value
    }

    fun loadCloudCredentialRecoveryState(): CloudCredentialRecoveryState? {
        return decodeCloudCredentialRecoveryStateFromRawValue(rawValue = cloudCredentialRecoveryStateJson.value)
    }

    fun saveCloudCredentialRecoveryState(recoveryState: CloudCredentialRecoveryState) {
        val rawValue = encodeCloudCredentialRecoveryState(recoveryState = recoveryState).toString()
        metadataPreferences.edit(commit = true) {
            putString(
                cloudCredentialRecoveryStateKey,
                rawValue
            )
        }
        cloudCredentialRecoveryStateJson.value = rawValue
    }

    fun clearCloudCredentialRecoveryState() {
        metadataPreferences.edit(commit = true) {
            remove(cloudCredentialRecoveryStateKey)
        }
        cloudCredentialRecoveryStateJson.value = null
    }

    fun loadCredentials(): StoredCloudCredentials? {
        val secrets = credentialStore.load()
        val refreshToken = secrets.refreshToken ?: return null
        val idToken = secrets.idToken ?: return null
        val idTokenExpiresAtMillis = secrets.idTokenExpiresAtMillis ?: return null
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
        credentialStore.update { secrets ->
            secrets.copy(
                refreshToken = credentials.refreshToken,
                idToken = credentials.idToken,
                idTokenExpiresAtMillis = credentials.idTokenExpiresAtMillis
            )
        }
    }

    fun clearCredentials() {
        credentialStore.clear()
    }

    fun clearCredentialsRetainingSignInHint() {
        credentialStore.update { secrets ->
            secrets.copy(refreshToken = null, idToken = null, idTokenExpiresAtMillis = null,
                pendingGuestUpgrade = null, pendingSocialSignIn = null, pendingEmailSignIn = null, pendingAccountMethod = null)
        }
    }

    fun updateIdToken(idToken: String, idTokenExpiresAtMillis: Long) {
        credentialStore.update { secrets ->
            secrets.copy(idToken = idToken, idTokenExpiresAtMillis = idTokenExpiresAtMillis)
        }
    }

    suspend fun initializeFirstReviewOnboarding() {
        val settings = currentCloudSettings()
        accountPreferencesStore.initializeFirstReviewOnboarding(
            owner = firstReviewOnboardingOwner(),
            hasHistory = database.reviewLogDao().countReviewLogs() > 0,
            isLocalGuest = settings.cloudState == CloudAccountState.DISCONNECTED || settings.cloudState == CloudAccountState.GUEST
        )
    }

    internal fun firstReviewOnboardingOwner(): String {
        val settings = currentCloudSettings()
        if (settings.cloudState == CloudAccountState.DISCONNECTED) {
            // Session loss keeps the prior owner until a recovered identity can be compared.
            accountPreferencesStore.firstReviewOnboardingOwner()?.let { return it }
        }
        return currentServerConfiguration().apiBaseUrl + ":" + (settings.linkedUserId ?: settings.installationId)
    }

    fun saveFirstReviewOnboardingCompletedForOwner(completed: Boolean, owner: String): Boolean {
        return accountPreferencesStore.saveFirstReviewOnboardingCompleted(completed, owner)
    }

    internal fun pendingFirstReviewOnboardingEdit(): PendingFirstReviewOnboardingEdit? =
        accountPreferencesStore.pendingFirstReviewOnboardingEdit()

    internal suspend fun pushPendingFirstReviewOnboarding(
        remoteService: CloudRemoteGateway,
        apiBaseUrl: String,
        authorizationHeader: String
    ) {
        firstReviewOnboardingDeliveryGate.lock()
        try {
            while (true) {
                val edit = pendingFirstReviewOnboardingEdit() ?: return
                if (edit.owner != firstReviewOnboardingOwner()) return
                val preferences = remoteService.updateAccountPreferences(
                    apiBaseUrl = apiBaseUrl,
                    authorizationHeader = authorizationHeader,
                    update = AccountPreferencesUpdate(
                        accentColor = null,
                        reviewReactionAnimationsEnabled = null,
                        productAnalyticsEnabled = null,
                        productAnalyticsEnabledOrigin = null,
                        locale = null,
                        firstReviewOnboardingCompleted = edit.completed
                    )
                )
                check(preferences.firstReviewOnboardingCompleted == edit.completed) {
                    "Cloud did not acknowledge the requested first review onboarding preference."
                }
                accountPreferencesStore.acknowledgeFirstReviewOnboarding(edit)
            }
        } finally {
            firstReviewOnboardingDeliveryGate.unlock()
        }
    }

    fun saveAccountPreferences(preferences: AccountPreferences) {
        accountPreferencesStore.saveAccountPreferences(preferences = preferences)
    }

    fun savePushedAccountPreferences(preferences: AccountPreferences) {
        accountPreferencesStore.savePushedAccountPreferences(preferences = preferences)
    }

    fun saveProductAnalyticsEnabledPendingPush(enabled: Boolean) {
        accountPreferencesStore.saveProductAnalyticsEnabledPendingPush(enabled = enabled)
    }

    fun isProductAnalyticsEnabledPendingPush(): Boolean {
        return accountPreferencesStore.isProductAnalyticsEnabledPendingPush()
    }

    fun isProductAnalyticsEnabledPushRefused(): Boolean {
        return accountPreferencesStore.isProductAnalyticsEnabledPushRefused()
    }

    fun clearProductAnalyticsEnabledPendingPushIfAnswerIs(enabled: Boolean) {
        accountPreferencesStore.clearProductAnalyticsEnabledPendingPushIfAnswerIs(enabled = enabled)
    }

    fun markProductAnalyticsEnabledPushRefusedIfAnswerIs(enabled: Boolean): Boolean {
        return accountPreferencesStore.markProductAnalyticsEnabledPushRefusedIfAnswerIs(enabled = enabled)
    }

    fun clearAccountPreferences() {
        accountPreferencesStore.clearAccountPreferences()
        if (currentCloudSettings().cloudState == CloudAccountState.DISCONNECTED) {
            accountPreferencesStore.initializeFirstReviewOnboarding(firstReviewOnboardingOwner(), false, true)
        }
    }

    fun clearAccountPreferencesForCredentialLoss() {
        accountPreferencesStore.clearAccountPreferencesForCredentialLoss()
    }

    /** Keyed by user rather than cleared at identity boundaries, so a new user id is always saved again. */
    fun loadSavedAppLocale(): SavedAppLocale? {
        val userId = metadataPreferences.getString(savedAppLocaleUserIdKey, null) ?: return null
        val locale = metadataPreferences.getString(savedAppLocaleKey, null) ?: return null
        return SavedAppLocale(userId = userId, locale = locale)
    }

    fun saveSavedAppLocale(savedAppLocale: SavedAppLocale) {
        metadataPreferences.edit(commit = true) {
            putString(savedAppLocaleUserIdKey, savedAppLocale.userId)
            putString(savedAppLocaleKey, savedAppLocale.locale)
        }
    }

    internal fun loadPendingGuestUpgrade(): PendingGuestUpgradeState? {
        val rawValue = credentialStore.load().pendingGuestUpgrade ?: return null
        return try {
            decodePendingGuestUpgrade(rawValue = rawValue)
        } catch (error: JSONException) {
            throw pendingGuestUpgradeRecoveryStateCorruptError(cause = error)
        } catch (error: IllegalArgumentException) {
            throw pendingGuestUpgradeRecoveryStateCorruptError(cause = error)
        } catch (error: IllegalStateException) {
            throw pendingGuestUpgradeRecoveryStateCorruptError(cause = error)
        }
    }

    internal fun savePendingGuestUpgrade(pendingGuestUpgradeState: PendingGuestUpgradeState) {
        credentialStore.update { secrets ->
            secrets.copy(
                pendingGuestUpgrade = encodePendingGuestUpgrade(pendingGuestUpgradeState = pendingGuestUpgradeState).toString()
            )
        }
    }

    internal fun clearPendingGuestUpgrade() {
        credentialStore.update { secrets ->
            secrets.copy(pendingGuestUpgrade = null)
        }
    }

    internal suspend fun <Result> runWithLocalOutboxWritesBlocked(
        reason: String,
        block: suspend () -> Result
    ): Result {
        val transactionsDrained = activateLocalOutboxWriteBlock(reason = reason)
        try {
            transactionsDrained.await()
            return block()
        } finally {
            clearLocalOutboxWriteBlock()
        }
    }

    internal suspend fun <Result> runWithLocalOutboxMutationAllowed(block: suspend () -> Result): Result {
        beginLocalOutboxMutationTransaction()
        try {
            return withContext(LocalOutboxMutationContextElement()) {
                block()
            }
        } finally {
            finishLocalOutboxMutationTransaction()
        }
    }

    internal suspend fun <Result> runWithLocalOutboxWritesAllowed(block: suspend () -> Result): Result {
        if (isLocalOutboxMutationTransactionActive()) {
            return block()
        }

        localOutboxWriteGate.lock()
        try {
            requireLocalOutboxWritesAllowedLocked()
            return block()
        } finally {
            localOutboxWriteGate.unlock()
        }
    }

    private suspend fun activateLocalOutboxWriteBlock(reason: String): CompletableDeferred<Unit> {
        localOutboxWriteGate.lock()
        try {
            check(localOutboxWriteBlockReason == null) {
                "Local outbox writes are already blocked. Existing reason='$localOutboxWriteBlockReason'"
            }
            check(hasPendingGuestUpgrade().not()) {
                pendingGuestUpgradeLocalOutboxBlockReason
            }
            localOutboxWriteBlockReason = reason
            return localOutboxMutationTransactionsDrained
        } finally {
            localOutboxWriteGate.unlock()
        }
    }

    private suspend fun clearLocalOutboxWriteBlock() {
        localOutboxWriteGate.lock()
        try {
            localOutboxWriteBlockReason = null
        } finally {
            localOutboxWriteGate.unlock()
        }
    }

    private suspend fun beginLocalOutboxMutationTransaction() {
        localOutboxWriteGate.lock()
        try {
            requireLocalOutboxWritesAllowedLocked()
            if (activeLocalOutboxMutationTransactions == 0) {
                localOutboxMutationTransactionsDrained = CompletableDeferred()
            }
            activeLocalOutboxMutationTransactions += 1
        } finally {
            localOutboxWriteGate.unlock()
        }
    }

    private suspend fun finishLocalOutboxMutationTransaction() {
        localOutboxWriteGate.lock()
        try {
            check(activeLocalOutboxMutationTransactions > 0) {
                "Local outbox mutation transaction finished without a matching start."
            }
            activeLocalOutboxMutationTransactions -= 1
            if (activeLocalOutboxMutationTransactions == 0) {
                localOutboxMutationTransactionsDrained.complete(Unit)
            }
        } finally {
            localOutboxWriteGate.unlock()
        }
    }

    private suspend fun isLocalOutboxMutationTransactionActive(): Boolean {
        return coroutineContext[LocalOutboxMutationContextKey] != null
    }

    private suspend fun requireLocalOutboxWritesAllowedLocked() {
        if (hasPendingGuestUpgrade()) {
            throw IllegalStateException(pendingGuestUpgradeLocalOutboxBlockReason)
        }
        val blockedReason = localOutboxWriteBlockReason ?: return
        throw IllegalStateException(blockedReason)
    }

    private suspend fun hasPendingGuestUpgrade(): Boolean {
        return withContext(Dispatchers.IO) {
            credentialStore.load().pendingGuestUpgrade != null
        }
    }

    suspend fun hydrateCloudSettingsFromDatabase(): CloudSettings {
        val hydratedSettings = loadPersistedCloudSettingsEntity()
        val settings = persistInMemoryCloudSettings(settings = hydratedSettings)
        initializeFirstReviewOnboarding()
        return settings
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
        // The entitlement belongs to the user it was pulled for, so it never outlives a user change.
        if (currentSettings.linkedUserId != linkedUserId) {
            entitlementStore.clearEntitlement()
            if (cloudState != CloudAccountState.DISCONNECTED) {
                val installationOwner = currentServerConfiguration().apiBaseUrl + ":" + currentSettings.installationId
                accountPreferencesStore.changeFirstReviewOnboardingOwner(
                    owner = currentServerConfiguration().apiBaseUrl + ":" + (linkedUserId ?: currentSettings.installationId),
                    isNewGuestBinding = currentSettings.linkedUserId == null &&
                        cloudState == CloudAccountState.GUEST &&
                        accountPreferencesStore.firstReviewOnboardingOwner() == installationOwner
                )
            }
        }
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
        if (cloudState == CloudAccountState.DISCONNECTED) {
            accountPreferencesStore.initializeFirstReviewOnboarding(firstReviewOnboardingOwner(), false, true)
        }
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
            remove(accountDeletionFailureReportIdKey)
        }
        accountDeletionState.value = AccountDeletionState.InProgress
    }

    fun markAccountDeletionFailed(message: String) {
        val reportId = nextAccountDeletionFailureReportId()
        metadataPreferences.edit(commit = true) {
            putString(accountDeletionStatusKey, accountDeletionStatusFailed)
            putString(accountDeletionFailureMessageKey, message)
            putString(accountDeletionFailureReportIdKey, reportId)
        }
        accountDeletionState.value = AccountDeletionState.Failed(
            message = message,
            technicalDetailsReportId = reportId
        )
    }

    fun clearAccountDeletionState() {
        metadataPreferences.edit(commit = true) {
            putString(accountDeletionStatusKey, accountDeletionStatusHidden)
            remove(accountDeletionFailureMessageKey)
            remove(accountDeletionFailureReportIdKey)
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
        accountPreferencesStore.initializeFirstReviewOnboarding(
            owner = currentServerConfiguration().apiBaseUrl + ":" + installationId,
            hasHistory = false,
            isLocalGuest = true
        )
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
            accountDeletionStatusFailed -> {
                val message = metadataPreferences.getString(accountDeletionFailureMessageKey, null)
                    ?: "Account deletion failed."
                AccountDeletionState.Failed(
                    message = message,
                    technicalDetailsReportId = metadataPreferences.getString(
                        accountDeletionFailureReportIdKey,
                        null
                    ) ?: legacyAccountDeletionFailureReportId(message = message)
                )
            }
            else -> AccountDeletionState.Hidden
        }
    }

    private fun nextAccountDeletionFailureReportId(): String {
        return "account-deletion-state-failed:${UUID.randomUUID()}"
    }

    private fun legacyAccountDeletionFailureReportId(message: String): String {
        return "account-deletion-state-failed:legacy:${message.hashCode()}"
    }

    private fun loadCloudCredentialRecoveryStateJsonFromPreferences(): String? {
        return metadataPreferences.getString(cloudCredentialRecoveryStateKey, null)
    }

    private fun decodeCloudCredentialRecoveryStateFromRawValue(rawValue: String?): CloudCredentialRecoveryState? {
        rawValue ?: return null
        return try {
            decodeCloudCredentialRecoveryState(jsonObject = JSONObject(rawValue))
        } catch (error: JSONException) {
            invalidStoredCloudCredentialRecoveryState()
        } catch (error: IllegalArgumentException) {
            invalidStoredCloudCredentialRecoveryState()
        } catch (error: IllegalStateException) {
            invalidStoredCloudCredentialRecoveryState()
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

internal data class PendingGuestUpgradeState(
    val configuration: CloudServiceConfiguration,
    val credentials: StoredCloudCredentials,
    val accountSnapshot: CloudAccountSnapshot,
    val guestSession: StoredGuestAiSession,
    val guestUpgradeMode: CloudGuestUpgradeMode,
    val selection: CloudWorkspaceLinkSelection,
    val completion: CloudGuestUpgradeCompletion?
) {
    init {
        require(selection !is CloudWorkspaceLinkSelection.Existing || !selection.discardDemoOnly ||
            (guestUpgradeMode == CloudGuestUpgradeMode.MERGE_REQUIRED && selection.workspaceId.isNotBlank())) {
            "Pending demo-only disposal requires a merge-required upgrade with an existing destination."
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

private fun encodePendingGuestUpgrade(pendingGuestUpgradeState: PendingGuestUpgradeState): JSONObject {
    val jsonObject = JSONObject()
        .put("configuration", encodeConfiguration(configuration = pendingGuestUpgradeState.configuration))
        .put("credentials", encodeCredentials(credentials = pendingGuestUpgradeState.credentials))
        .put("accountSnapshot", encodeAccountSnapshot(accountSnapshot = pendingGuestUpgradeState.accountSnapshot))
        .put("guestSession", encodeGuestSession(session = pendingGuestUpgradeState.guestSession))
        .put("guestUpgradeMode", pendingGuestUpgradeState.guestUpgradeMode.name)
        .put("selection", encodeWorkspaceLinkSelection(selection = pendingGuestUpgradeState.selection))
    val completion: CloudGuestUpgradeCompletion? = pendingGuestUpgradeState.completion
    if (completion == null) {
        jsonObject.put("completion", JSONObject.NULL)
    } else {
        jsonObject.put(
            "completion",
            encodeGuestUpgradeCompletion(completion = completion)
        )
    }
    return jsonObject
}

private fun decodePendingGuestUpgrade(rawValue: String): PendingGuestUpgradeState {
    val jsonObject = JSONObject(rawValue)
    return PendingGuestUpgradeState(
        configuration = decodeConfiguration(jsonObject = jsonObject.getJSONObject("configuration")),
        credentials = decodeCredentials(jsonObject = jsonObject.getJSONObject("credentials")),
        accountSnapshot = decodeAccountSnapshot(jsonObject = jsonObject.getJSONObject("accountSnapshot")),
        guestSession = decodeGuestSession(jsonObject = jsonObject.getJSONObject("guestSession")),
        guestUpgradeMode = CloudGuestUpgradeMode.valueOf(jsonObject.getString("guestUpgradeMode")),
        selection = decodeWorkspaceLinkSelection(jsonObject = jsonObject.getJSONObject("selection")),
        completion = decodeNullableGuestUpgradeCompletion(jsonObject = jsonObject)
    )
}

private fun pendingGuestUpgradeRecoveryStateCorruptError(cause: Throwable): IllegalStateException {
    return IllegalStateException(
        "Pending guest upgrade recovery state is corrupt and cannot be resumed. " +
            "Sign out and sign in again to reset cloud identity recovery. Cause='${cause.message}'.",
        cause
    )
}

private fun encodeConfiguration(configuration: CloudServiceConfiguration): JSONObject {
    return JSONObject()
        .put("mode", configuration.mode.name)
        .putNullableString(key = "customOrigin", value = configuration.customOrigin)
        .put("apiBaseUrl", configuration.apiBaseUrl)
        .put("authBaseUrl", configuration.authBaseUrl)
}

private fun decodeConfiguration(jsonObject: JSONObject): CloudServiceConfiguration {
    return CloudServiceConfiguration(
        mode = CloudServiceConfigurationMode.valueOf(jsonObject.getString("mode")),
        customOrigin = jsonObject.getNullableString(key = "customOrigin"),
        apiBaseUrl = jsonObject.getString("apiBaseUrl"),
        authBaseUrl = jsonObject.getString("authBaseUrl")
    )
}

private fun encodeCredentials(credentials: StoredCloudCredentials): JSONObject {
    return JSONObject()
        .put("refreshToken", credentials.refreshToken)
        .put("idToken", credentials.idToken)
        .put("idTokenExpiresAtMillis", credentials.idTokenExpiresAtMillis)
}

private fun decodeCredentials(jsonObject: JSONObject): StoredCloudCredentials {
    return StoredCloudCredentials(
        refreshToken = jsonObject.getString("refreshToken"),
        idToken = jsonObject.getString("idToken"),
        idTokenExpiresAtMillis = jsonObject.getLong("idTokenExpiresAtMillis")
    )
}

private fun encodeAccountSnapshot(accountSnapshot: CloudAccountSnapshot): JSONObject {
    return JSONObject()
        .put("userId", accountSnapshot.userId)
        .putNullableString(key = "email", value = accountSnapshot.email)
        .put("preferences", encodeAccountPreferences(preferences = accountSnapshot.preferences))
        .put("workspaces", encodeWorkspaces(workspaces = accountSnapshot.workspaces))
}

private fun decodeAccountSnapshot(jsonObject: JSONObject): CloudAccountSnapshot {
    return CloudAccountSnapshot(
        userId = jsonObject.getString("userId"),
        email = jsonObject.getNullableString(key = "email"),
        preferences = decodeStoredAccountPreferences(jsonObject = jsonObject),
        workspaces = decodeWorkspaces(jsonArray = jsonObject.getJSONArray("workspaces"))
    )
}

private fun encodeAccountPreferences(preferences: AccountPreferences): JSONObject {
    return JSONObject()
        .put("accentColor", preferences.accentColor)
        .put("reviewReactionAnimationsEnabled", preferences.reviewReactionAnimationsEnabled)
        .put("firstReviewOnboardingCompleted", preferences.firstReviewOnboardingCompleted ?: JSONObject.NULL)
        .put("productAnalyticsEnabled", preferences.productAnalyticsEnabled ?: JSONObject.NULL)
}

private fun decodeAccountPreferences(jsonObject: JSONObject?): AccountPreferences {
    jsonObject ?: return defaultAccountPreferences().copy(firstReviewOnboardingCompleted = null)
    return AccountPreferences(
        accentColor = if (jsonObject.has("accentColor")) {
            jsonObject.getString("accentColor")
        } else {
            defaultAccentColor
        },
        reviewReactionAnimationsEnabled = jsonObject.getBoolean("reviewReactionAnimationsEnabled"),
        firstReviewOnboardingCompleted = if (
            !jsonObject.has("firstReviewOnboardingCompleted") || jsonObject.isNull("firstReviewOnboardingCompleted")
        ) {
            null
        } else {
            jsonObject.getBoolean("firstReviewOnboardingCompleted")
        },
        productAnalyticsEnabled = if (jsonObject.isNull("productAnalyticsEnabled")) {
            null
        } else {
            jsonObject.getBoolean("productAnalyticsEnabled")
        }
    )
}

private fun decodeStoredAccountPreferences(jsonObject: JSONObject): AccountPreferences {
    return if (jsonObject.has("preferences").not() || jsonObject.isNull("preferences")) {
        defaultAccountPreferences().copy(firstReviewOnboardingCompleted = null)
    } else {
        decodeAccountPreferences(jsonObject = jsonObject.getJSONObject("preferences"))
    }
}

private fun encodeWorkspaces(workspaces: List<CloudWorkspaceSummary>): JSONArray {
    val jsonArray = JSONArray()
    workspaces.forEach { workspace ->
        jsonArray.put(encodeWorkspace(workspace = workspace))
    }
    return jsonArray
}

private fun decodeWorkspaces(jsonArray: JSONArray): List<CloudWorkspaceSummary> {
    return buildList {
        for (index in 0 until jsonArray.length()) {
            add(decodeWorkspace(jsonObject = jsonArray.getJSONObject(index)))
        }
    }
}

private fun encodeWorkspace(workspace: CloudWorkspaceSummary): JSONObject {
    return JSONObject()
        .put("workspaceId", workspace.workspaceId)
        .put("name", workspace.name)
        .put("createdAtMillis", workspace.createdAtMillis)
        .put("isSelected", workspace.isSelected)
        .put("isVisible", workspace.isVisible)
}

private fun decodeWorkspace(jsonObject: JSONObject): CloudWorkspaceSummary {
    return CloudWorkspaceSummary(
        workspaceId = jsonObject.getString("workspaceId"),
        name = jsonObject.getString("name"),
        createdAtMillis = jsonObject.getLong("createdAtMillis"),
        isSelected = jsonObject.getBoolean("isSelected"),
        isVisible = if (jsonObject.has("isVisible")) jsonObject.getBoolean("isVisible") else true
    )
}

private fun encodeGuestSession(session: StoredGuestAiSession): JSONObject {
    return JSONObject()
        .put("guestToken", session.guestToken)
        .put("userId", session.userId)
        .put("workspaceId", session.workspaceId)
        .put("configurationMode", session.configurationMode.name)
        .put("apiBaseUrl", session.apiBaseUrl)
}

private fun decodeGuestSession(jsonObject: JSONObject): StoredGuestAiSession {
    return StoredGuestAiSession(
        guestToken = jsonObject.getString("guestToken"),
        userId = jsonObject.getString("userId"),
        workspaceId = jsonObject.getString("workspaceId"),
        configurationMode = CloudServiceConfigurationMode.valueOf(jsonObject.getString("configurationMode")),
        apiBaseUrl = jsonObject.getString("apiBaseUrl")
    )
}

private fun encodeWorkspaceLinkSelection(selection: CloudWorkspaceLinkSelection): JSONObject {
    return when (selection) {
        is CloudWorkspaceLinkSelection.Existing -> JSONObject()
            .put("type", "existing")
            .put("workspaceId", selection.workspaceId)
            .put("discardDemoOnly", selection.discardDemoOnly)

        CloudWorkspaceLinkSelection.CreateNew -> JSONObject()
            .put("type", "create_new")
    }
}

private fun decodeWorkspaceLinkSelection(jsonObject: JSONObject): CloudWorkspaceLinkSelection {
    return when (val selectionType = jsonObject.getString("type")) {
        "existing" -> CloudWorkspaceLinkSelection.Existing(
            workspaceId = jsonObject.getString("workspaceId"),
            discardDemoOnly = if (jsonObject.has("discardDemoOnly")) {
                jsonObject.requireCloudBoolean("discardDemoOnly", "pendingGuestUpgrade.selection.discardDemoOnly")
            } else {
                false
            }
        )
        "create_new" -> CloudWorkspaceLinkSelection.CreateNew
        else -> throw IllegalStateException("Unknown pending guest upgrade selection type '$selectionType'.")
    }
}

private fun encodeGuestUpgradeCompletion(completion: CloudGuestUpgradeCompletion): JSONObject {
    val jsonObject = JSONObject()
        .put("workspace", encodeWorkspace(workspace = completion.workspace))
    if (completion.reconciliation == null) {
        jsonObject.put("reconciliation", JSONObject.NULL)
    } else {
        jsonObject.put(
            "reconciliation",
            encodeGuestUpgradeReconciliation(reconciliation = completion.reconciliation)
        )
    }
    return jsonObject
}

private fun decodeGuestUpgradeCompletion(jsonObject: JSONObject): CloudGuestUpgradeCompletion {
    val reconciliation = if (jsonObject.isNull("reconciliation")) {
        null
    } else {
        decodeGuestUpgradeReconciliation(jsonObject = jsonObject.getJSONObject("reconciliation"))
    }
    return CloudGuestUpgradeCompletion(
        workspace = decodeWorkspace(jsonObject = jsonObject.getJSONObject("workspace")),
        reconciliation = reconciliation
    )
}

private fun decodeNullableGuestUpgradeCompletion(jsonObject: JSONObject): CloudGuestUpgradeCompletion? {
    return if (jsonObject.isNull("completion")) {
        null
    } else {
        decodeGuestUpgradeCompletion(jsonObject = jsonObject.getJSONObject("completion"))
    }
}

private fun encodeCloudCredentialRecoveryState(recoveryState: CloudCredentialRecoveryState): JSONObject {
    return JSONObject()
        .put("reason", recoveryState.reason.name)
        .put("previousCloudState", recoveryState.previousCloudState.name)
        .put("installationId", recoveryState.installationId)
        .putNullableString(key = "linkedUserId", value = recoveryState.linkedUserId)
        .putNullableString(key = "linkedWorkspaceId", value = recoveryState.linkedWorkspaceId)
        .putNullableString(key = "activeWorkspaceId", value = recoveryState.activeWorkspaceId)
        .putNullableString(key = "linkedEmail", value = recoveryState.linkedEmail)
        .put("configurationMode", recoveryState.configurationMode.name)
        .put("apiBaseUrl", recoveryState.apiBaseUrl)
        .put("detectedAtMillis", recoveryState.detectedAtMillis)
}

private fun decodeCloudCredentialRecoveryState(jsonObject: JSONObject): CloudCredentialRecoveryState {
    requireCloudCredentialRecoveryStateKnownKeys(jsonObject = jsonObject)
    return CloudCredentialRecoveryState(
        reason = CloudCredentialRecoveryReason.valueOf(jsonObject.getString("reason")),
        previousCloudState = CloudAccountState.valueOf(jsonObject.getString("previousCloudState")),
        installationId = jsonObject.getString("installationId"),
        linkedUserId = jsonObject.getNullableString(key = "linkedUserId"),
        linkedWorkspaceId = jsonObject.getNullableString(key = "linkedWorkspaceId"),
        activeWorkspaceId = jsonObject.getNullableString(key = "activeWorkspaceId"),
        linkedEmail = jsonObject.getNullableString(key = "linkedEmail"),
        configurationMode = CloudServiceConfigurationMode.valueOf(jsonObject.getString("configurationMode")),
        apiBaseUrl = jsonObject.getString("apiBaseUrl"),
        detectedAtMillis = jsonObject.getLong("detectedAtMillis")
    )
}

private fun requireCloudCredentialRecoveryStateKnownKeys(jsonObject: JSONObject) {
    val expectedKeys = setOf(
        "reason",
        "previousCloudState",
        "installationId",
        "linkedUserId",
        "linkedWorkspaceId",
        "activeWorkspaceId",
        "linkedEmail",
        "configurationMode",
        "apiBaseUrl",
        "detectedAtMillis"
    )
    val actualKeys = jsonObject.keys().asSequence().toSet()
    val unknownKeys = actualKeys - expectedKeys
    require(unknownKeys.isEmpty()) {
        "Cloud credential recovery state contains unknown keys: ${unknownKeys.sorted().joinToString()}."
    }
}

private fun invalidStoredCloudCredentialRecoveryState(): CloudCredentialRecoveryState {
    return CloudCredentialRecoveryState(
        reason = CloudCredentialRecoveryReason.INVALID_STORED_STATE,
        previousCloudState = CloudAccountState.DISCONNECTED,
        installationId = "",
        linkedUserId = null,
        linkedWorkspaceId = null,
        activeWorkspaceId = null,
        linkedEmail = null,
        configurationMode = CloudServiceConfigurationMode.OFFICIAL,
        apiBaseUrl = "",
        detectedAtMillis = System.currentTimeMillis()
    )
}

private fun encodeGuestUpgradeReconciliation(reconciliation: CloudGuestUpgradeReconciliation): JSONObject {
    val droppedEntities = JSONArray()
    reconciliation.droppedEntities.forEach { droppedEntity ->
        droppedEntities.put(
            JSONObject()
                .put("entityType", droppedEntity.entityType.name)
                .put("entityId", droppedEntity.entityId)
        )
    }
    return JSONObject().put("droppedEntities", droppedEntities)
}

private fun decodeGuestUpgradeReconciliation(jsonObject: JSONObject): CloudGuestUpgradeReconciliation {
    val droppedEntities = jsonObject.getJSONArray("droppedEntities")
    return CloudGuestUpgradeReconciliation(
        droppedEntities = buildList {
            for (index in 0 until droppedEntities.length()) {
                val droppedEntity = droppedEntities.getJSONObject(index)
                add(
                    CloudGuestUpgradeDroppedEntity(
                        entityType = CloudGuestUpgradeDroppedEntityType.valueOf(
                            droppedEntity.getString("entityType")
                        ),
                        entityId = droppedEntity.getString("entityId")
                    )
                )
            }
        }
    )
}

private fun JSONObject.getNullableString(key: String): String? {
    return if (isNull(key)) {
        null
    } else {
        getString(key)
    }
}

private const val accountDeletionStatusHidden: String = "hidden"
private const val accountDeletionStatusInProgress: String = "in_progress"
private const val accountDeletionStatusFailed: String = "failed"
