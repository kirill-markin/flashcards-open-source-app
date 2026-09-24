package com.flashcardsopensourceapp.data.local.cloud

import android.content.SharedPreferences
import androidx.core.content.edit
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferences
import com.flashcardsopensourceapp.data.local.model.sync.defaultAccountPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

private const val reviewReactionAnimationsEnabledKey: String = "review-reaction-animations-enabled"
private const val productAnalyticsEnabledKey: String = "product-analytics-enabled"
private const val productAnalyticsEnabledPendingPushKey: String = "product-analytics-enabled-pending-push"
private const val productAnalyticsEnabledIsDeviceAnswerKey: String = "product-analytics-enabled-is-device-answer"
private const val productAnalyticsEnabledPushRefusedKey: String = "product-analytics-enabled-push-refused"

internal class CloudAccountPreferencesStore(
    private val metadataPreferences: SharedPreferences
) {
    private val accountPreferencesState = MutableStateFlow(loadAccountPreferences())
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

    fun observeAccountPreferences(): StateFlow<AccountPreferences> {
        return accountPreferencesState.asStateFlow()
    }

    fun currentAccountPreferences(): AccountPreferences {
        return accountPreferencesState.value
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
}
