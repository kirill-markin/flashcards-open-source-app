package com.flashcardsopensourceapp.data.local.cloud

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.AppLocalSettingsEntity
import com.flashcardsopensourceapp.data.local.cloud.wire.putNullableString
import com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
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
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferences
import com.flashcardsopensourceapp.data.local.model.sync.defaultAccountPreferences
import kotlinx.coroutines.CompletableDeferred
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
private const val accountDeletionFailureReportIdKey: String = "account-deletion-failure-report-id"
private const val customOriginKey: String = "custom-origin"
private const val cloudCredentialRecoveryStateKey: String = "cloud-credential-recovery-state"
private const val reviewReactionAnimationsEnabledKey: String = "review-reaction-animations-enabled"
private const val productAnalyticsEnabledKey: String = "product-analytics-enabled"
private const val productAnalyticsEnabledPendingPushKey: String = "product-analytics-enabled-pending-push"
private const val productAnalyticsEnabledIsDeviceAnswerKey: String = "product-analytics-enabled-is-device-answer"
private const val productAnalyticsEnabledPushRefusedKey: String = "product-analytics-enabled-push-refused"
private const val refreshTokenKey: String = "refresh-token"
private const val idTokenKey: String = "id-token"
private const val idTokenExpiresAtMillisKey: String = "id-token-expires-at-millis"
private const val pendingGuestUpgradeKey: String = "pending-guest-upgrade"
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
    private val securePreferences: SharedPreferences = context.getSharedPreferences(
        cloudSecretPreferencesName,
        Context.MODE_PRIVATE
    )

    private val cloudSettingsState = MutableStateFlow(loadLegacyCloudSettingsEntity().toCloudSettings())
    private val accountPreferencesState = MutableStateFlow(loadAccountPreferences())
    private val accountDeletionState = MutableStateFlow(loadAccountDeletionState())
    private val serverConfigurationState = MutableStateFlow(loadServerConfiguration())
    private val cloudCredentialRecoveryStateJson = MutableStateFlow(loadCloudCredentialRecoveryStateJsonFromPreferences())
    /**
     * One lock over every product-analytics answer mutation.
     *
     * The answer, its device-answer marker and its pending-push marker only mean anything read
     * together, and they are written from both the main thread — the Settings toggle, deliberately
     * outside the operation coordinator — and `Dispatchers.IO`, where every account read and the
     * push itself run. Without it a refresh could read "no device answer", then commit the remote
     * value over an opt-out that landed in between, leaving the pending marker set so the next push
     * sent the server the opposite of what the person asked for.
     *
     * Held only across `SharedPreferences` commits and state-flow writes, never around suspending
     * work and never taken inside an `edit { }` lambda, so the main-thread toggle waits at most for
     * another synchronous commit rather than for network I/O.
     */
    private val productAnalyticsAnswerLock = Any()
    private val localOutboxWriteGate = Mutex()
    private var localOutboxWriteBlockReason: String? = null
    private var activeLocalOutboxMutationTransactions: Int = 0
    private var localOutboxMutationTransactionsDrained: CompletableDeferred<Unit> = completedUnitSignal()

    fun observeCloudSettings(): StateFlow<CloudSettings> {
        return cloudSettingsState.asStateFlow()
    }

    fun observeAccountPreferences(): StateFlow<AccountPreferences> {
        return accountPreferencesState.asStateFlow()
    }

    fun observeServerConfiguration(): StateFlow<CloudServiceConfiguration> {
        return serverConfigurationState.asStateFlow()
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
        return accountPreferencesState.value
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
            remove(pendingGuestUpgradeKey)
        }
    }

    fun updateIdToken(idToken: String, idTokenExpiresAtMillis: Long) {
        securePreferences.edit(commit = true) {
            putString(idTokenKey, idToken)
            putLong(idTokenExpiresAtMillisKey, idTokenExpiresAtMillis)
        }
    }

    /**
     * Every account snapshot this install reads lands here, so this is where the stored analytics
     * answer is defended against the one the server reports.
     *
     * An answer given on this device wins on this device, in both directions, and a remote value
     * applies only where this device has no answer of its own. The two answers carry no timestamps
     * to order them by, so recency cannot decide between them, and the person holding the device is
     * the one whose answer is about the device. Turning collection back on from this device stays
     * possible — that is this device answering again, through
     * [saveProductAnalyticsEnabledPendingPush]. This is also the rule the iOS client follows.
     *
     * Keeping a device-given `true` against a remote `false` cannot over-collect for the person who
     * gave that `false`: their opt-out is enforced server-side at ingest, so events arriving under
     * their identity are dropped there whatever this device believes. Stickiness therefore only
     * decides what this device does on its own behalf, never what is retained for somebody else.
     *
     * Only an answer given here is sticky. A value merely mirrored from the server is not this
     * device's answer and stays replaceable by a later remote value, so a device that read `true`
     * once still follows a `false` set afterwards on another device instead of showing ON forever
     * while the account reads OFF. Which kind the stored value is lives in
     * [productAnalyticsEnabledIsDeviceAnswerKey].
     *
     * A `null` from the server is "nobody answered", never "the answer was withdrawn": the column
     * can only be set, never cleared, so it never replaces a mirror either. An install that never
     * answered still reads as on, because null over null stays null.
     *
     * When the identity being read has no answer of its own, a stored opt-out is re-armed for
     * delivery so it reaches that identity too. Only an opt-out, and only against a `null`:
     * re-arming an opt-in would write `true` onto an account that never asked for it, and pushing
     * over an explicit remote `true` would take this device's answer to every other device the
     * person owns, which is further than a switch on this one may reach.
     */
    fun saveAccountPreferences(preferences: AccountPreferences) {
        writeAccountPreferences(preferences = preferences, rearmUndeliveredOptOut = true)
    }

    /**
     * The response to a preferences update this device just sent, which is the server repeating
     * back what it was handed rather than news from another device.
     *
     * It therefore never re-arms the pending push. A server build that omits
     * `productAnalyticsEnabled` from its response would otherwise re-arm the very push this
     * response acknowledges, leaving the marker permanently set and re-issuing the same PATCH for
     * the life of the install.
     */
    fun savePushedAccountPreferences(preferences: AccountPreferences) {
        writeAccountPreferences(preferences = preferences, rearmUndeliveredOptOut = false)
    }

    private fun writeAccountPreferences(
        preferences: AccountPreferences,
        rearmUndeliveredOptOut: Boolean
    ) {
        // The whole read-decide-commit-publish sequence is one step: the sticky device-answer check
        // below is only worth anything if no toggle can land between it and the commit it guards.
        synchronized(productAnalyticsAnswerLock) {
            val storedProductAnalyticsEnabled: Boolean? = currentAccountPreferences().productAnalyticsEnabled
            val storedAnswerIsFromThisDevice: Boolean = metadataPreferences.getBoolean(
                productAnalyticsEnabledIsDeviceAnswerKey,
                false
            )
            val remoteProductAnalyticsEnabled: Boolean? = preferences.productAnalyticsEnabled
            val resolvedProductAnalyticsEnabled: Boolean? = if (storedAnswerIsFromThisDevice) {
                storedProductAnalyticsEnabled
            } else {
                remoteProductAnalyticsEnabled ?: storedProductAnalyticsEnabled
            }
            val resolvedPreferences: AccountPreferences =
                preferences.copy(productAnalyticsEnabled = resolvedProductAnalyticsEnabled)
            // An answer the server already refused for good is not re-armed: re-issuing the same
            // doomed push on every account read is what the refusal record exists to stop.
            val shouldRearmPendingPush: Boolean = rearmUndeliveredOptOut
                && resolvedProductAnalyticsEnabled == false
                && preferences.productAnalyticsEnabled == null
                && metadataPreferences.getBoolean(productAnalyticsEnabledPushRefusedKey, false).not()
            metadataPreferences.edit(commit = true) {
                putBoolean(
                    reviewReactionAnimationsEnabledKey,
                    resolvedPreferences.reviewReactionAnimationsEnabled
                )
                if (resolvedProductAnalyticsEnabled == null) {
                    remove(productAnalyticsEnabledKey)
                    remove(productAnalyticsEnabledIsDeviceAnswerKey)
                } else {
                    putBoolean(productAnalyticsEnabledKey, resolvedProductAnalyticsEnabled)
                }
                if (shouldRearmPendingPush) {
                    putBoolean(productAnalyticsEnabledPendingPushKey, true)
                }
            }
            accountPreferencesState.value = resolvedPreferences
        }
    }

    /**
     * Durable before anything else happens, and marked as owed to the server: the person asked this
     * device to stop, so the answer has to hold through a process death and a cold start that
     * precedes any session, and it still has to reach the account or guest session it belongs to.
     */
    fun saveProductAnalyticsEnabledPendingPush(enabled: Boolean) {
        synchronized(productAnalyticsAnswerLock) {
            // The one place an answer becomes this device's own, which is what makes it sticky
            // against every later remote value.
            metadataPreferences.edit(commit = true) {
                putBoolean(productAnalyticsEnabledKey, enabled)
                putBoolean(productAnalyticsEnabledIsDeviceAnswerKey, true)
                putBoolean(productAnalyticsEnabledPendingPushKey, true)
                // A fresh answer earns a fresh attempt, whatever the server said about the last one.
                remove(productAnalyticsEnabledPushRefusedKey)
            }
            accountPreferencesState.value = currentAccountPreferences().copy(productAnalyticsEnabled = enabled)
        }
    }

    fun isProductAnalyticsEnabledPendingPush(): Boolean {
        return metadataPreferences.getBoolean(productAnalyticsEnabledPendingPushKey, false)
    }

    /**
     * The refusal record, so the caller that gave an answer can read its outcome instead of
     * inferring it from having performed the push itself. A concurrent account refresh can deliver
     * — and get refused on — the pending answer, leaving that caller's own push a no-op with
     * nothing to report.
     *
     * A record found after [saveProductAnalyticsEnabledPendingPush] carries the value that call
     * armed: that call drops any earlier one in the same step, and
     * [markProductAnalyticsEnabledPushRefusedIfAnswerIs] only ever writes one while the value it
     * refuses is still the stored one. That is a value, not an answer, so the record is not
     * necessarily the verdict on this caller's own push — see the guard's own note there for
     * what that costs.
     */
    fun isProductAnalyticsEnabledPushRefused(): Boolean {
        return metadataPreferences.getBoolean(productAnalyticsEnabledPushRefusedKey, false)
    }

    /**
     * Marks the pushed answer delivered, but only while it is still the stored one.
     *
     * Compare and clear are one step under [productAnalyticsAnswerLock], because the caller cannot
     * do it across this boundary: the durable write happens outside the operation coordinator, so a
     * second toggle can land — and re-arm the marker — between a caller's check and its clear. The
     * clear would then wipe the marker that second answer just armed, its own push would find
     * nothing pending and send nothing, and the account would be left holding the answer before it.
     */
    fun clearProductAnalyticsEnabledPendingPushIfAnswerIs(enabled: Boolean) {
        synchronized(productAnalyticsAnswerLock) {
            if (currentAccountPreferences().productAnalyticsEnabled != enabled) {
                return
            }
            metadataPreferences.edit(commit = true) {
                remove(productAnalyticsEnabledPendingPushKey)
            }
        }
    }

    /**
     * The refused answer was refused by the server in a way repeating cannot fix, so it stops being
     * owed instead of being re-issued on every account read for the life of the install — but only
     * while it is still the stored one. Returns whether the refusal was recorded.
     *
     * Compare and record are one step under [productAnalyticsAnswerLock], for the same reason
     * [clearProductAnalyticsEnabledPendingPushIfAnswerIs] compares: the durable write happens
     * outside the operation coordinator, so a second toggle can land — and re-arm the marker —
     * while a push is parked in its PATCH. Recording unconditionally would wipe the marker that
     * second answer just armed and file a verdict it never earned; its own push would then find
     * nothing pending and send nothing, the re-arm would stay blocked by that record, and its
     * caller would be told its request was refused when no request was ever made for it.
     *
     * The comparison is value-scoped, not answer-scoped: two answers holding the same value are
     * indistinguishable here, so an off → on → off interleaving still gets through it. A first
     * opt-out parked in its PATCH can return a durable 4xx after a later opt-out has been stored and
     * armed; the compare sees the `false` that later answer wrote, drops its marker and files the
     * verdict against it, and that answer then sends nothing while reporting a refusal it never
     * earned. Bounded rather than prevented, because an identical body sent to the same server earns
     * an identical verdict, so the outcome reported is the one that answer would have received.
     * Telling the two apart needs a monotonic generation compared instead of the value.
     *
     * Recorded rather than merely un-marked, because the undelivered-opt-out re-arm in
     * [saveAccountPreferences] would otherwise put the same doomed push straight back. The record
     * is dropped by [saveProductAnalyticsEnabledPendingPush], so answering again on this device
     * always gets a real attempt, and by [clearAccountPreferences], so another identity — possibly
     * on another server — is never judged by the verdict this one gave.
     *
     * The answer itself is untouched: this device keeps honoring it locally either way.
     */
    fun markProductAnalyticsEnabledPushRefusedIfAnswerIs(enabled: Boolean): Boolean {
        synchronized(productAnalyticsAnswerLock) {
            if (currentAccountPreferences().productAnalyticsEnabled != enabled) {
                return false
            }
            metadataPreferences.edit(commit = true) {
                remove(productAnalyticsEnabledPendingPushKey)
                putBoolean(productAnalyticsEnabledPushRefusedKey, true)
            }
            return true
        }
    }

    /**
     * The product-analytics answer deliberately survives an identity boundary: it is this device's
     * instruction to stop collecting, and losing a session or signing out is not permission to
     * resume. Only this device answering again replaces it, through
     * [saveProductAnalyticsEnabledPendingPush].
     *
     * An undelivered opt-out stays owed across the boundary, so a device handed to somebody else
     * can carry it onto their account. That is the deliberate direction to err in: the same person
     * reconnecting after a lost session is the far likelier case, and dropping it there would let
     * an account with no answer of its own switch collection back on.
     *
     * An undelivered opt-in is not carried. The marker is dropped, and the direction is what makes
     * the two asymmetric: an opt-out landing on the wrong account collects less than it could, an
     * opt-in landing there would flip a `false` the new holder set on another surface, for all of
     * their devices. The local answer itself still survives, and it reads the same way `null` does.
     */
    fun clearAccountPreferences() {
        synchronized(productAnalyticsAnswerLock) {
            val carriedProductAnalyticsEnabled: Boolean? = currentAccountPreferences().productAnalyticsEnabled
            metadataPreferences.edit(commit = true) {
                remove(reviewReactionAnimationsEnabledKey)
                // The verdict belonged to the identity being left, not to the answer.
                remove(productAnalyticsEnabledPushRefusedKey)
                if (carriedProductAnalyticsEnabled != false) {
                    remove(productAnalyticsEnabledPendingPushKey)
                }
            }
            accountPreferencesState.value = defaultAccountPreferences().copy(
                productAnalyticsEnabled = carriedProductAnalyticsEnabled
            )
        }
    }

    internal fun loadPendingGuestUpgrade(): PendingGuestUpgradeState? {
        val rawValue = securePreferences.getString(pendingGuestUpgradeKey, null) ?: return null
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
        securePreferences.edit(commit = true) {
            putString(
                pendingGuestUpgradeKey,
                encodePendingGuestUpgrade(pendingGuestUpgradeState = pendingGuestUpgradeState).toString()
            )
        }
    }

    internal fun clearPendingGuestUpgrade() {
        securePreferences.edit(commit = true) {
            remove(pendingGuestUpgradeKey)
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

    private fun requireLocalOutboxWritesAllowedLocked() {
        if (hasPendingGuestUpgrade()) {
            throw IllegalStateException(pendingGuestUpgradeLocalOutboxBlockReason)
        }
        val blockedReason = localOutboxWriteBlockReason ?: return
        throw IllegalStateException(blockedReason)
    }

    private fun hasPendingGuestUpgrade(): Boolean {
        return securePreferences.contains(pendingGuestUpgradeKey)
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

    private fun loadAccountPreferences(): AccountPreferences {
        return AccountPreferences(
            reviewReactionAnimationsEnabled = metadataPreferences.getBoolean(
                reviewReactionAnimationsEnabledKey,
                true
            ),
            // Absent is "nobody answered" and stays null; only a stored false opts out.
            productAnalyticsEnabled = if (metadataPreferences.contains(productAnalyticsEnabledKey)) {
                metadataPreferences.getBoolean(productAnalyticsEnabledKey, true)
            } else {
                null
            }
        )
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
)

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
        .put("reviewReactionAnimationsEnabled", preferences.reviewReactionAnimationsEnabled)
        .put("productAnalyticsEnabled", preferences.productAnalyticsEnabled ?: JSONObject.NULL)
}

private fun decodeAccountPreferences(jsonObject: JSONObject?): AccountPreferences {
    jsonObject ?: return defaultAccountPreferences()
    return AccountPreferences(
        reviewReactionAnimationsEnabled = jsonObject.getBoolean("reviewReactionAnimationsEnabled"),
        productAnalyticsEnabled = if (jsonObject.isNull("productAnalyticsEnabled")) {
            null
        } else {
            jsonObject.getBoolean("productAnalyticsEnabled")
        }
    )
}

private fun decodeStoredAccountPreferences(jsonObject: JSONObject): AccountPreferences {
    return if (jsonObject.has("preferences").not() || jsonObject.isNull("preferences")) {
        defaultAccountPreferences()
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
}

private fun decodeWorkspace(jsonObject: JSONObject): CloudWorkspaceSummary {
    return CloudWorkspaceSummary(
        workspaceId = jsonObject.getString("workspaceId"),
        name = jsonObject.getString("name"),
        createdAtMillis = jsonObject.getLong("createdAtMillis"),
        isSelected = jsonObject.getBoolean("isSelected")
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

        CloudWorkspaceLinkSelection.CreateNew -> JSONObject()
            .put("type", "create_new")
    }
}

private fun decodeWorkspaceLinkSelection(jsonObject: JSONObject): CloudWorkspaceLinkSelection {
    return when (val selectionType = jsonObject.getString("type")) {
        "existing" -> CloudWorkspaceLinkSelection.Existing(
            workspaceId = jsonObject.getString("workspaceId")
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
