package com.flashcardsopensourceapp.app.store

import android.content.Context
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.lifecycle.Lifecycle
import com.flashcardsopensourceapp.data.local.database.ReviewLogDao
import com.flashcardsopensourceapp.data.local.review.StoreReviewRequestStore
import com.flashcardsopensourceapp.data.local.review.determineStoreReviewRequestEligibility
import com.google.android.gms.tasks.Task
import com.google.android.play.core.review.ReviewException
import com.google.android.play.core.review.ReviewInfo
import com.google.android.play.core.review.ReviewManager
import com.google.android.play.core.review.ReviewManagerFactory
import java.time.ZoneId
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

private const val storeReviewRequestLogTag: String = "StoreReviewRequest"
private const val storeReviewRequestedAnalyticsEventName: String = "store_review_requested"
private const val storeReviewRequestedAnalyticsPlatform: String = "android"

data class StoreReviewRequestedAnalyticsEvent(
    val name: String,
    val platform: String,
    val appVersion: String,
    val localTimestampMillis: Long,
    val installationId: String?
)

interface StoreReviewAnalyticsReporter {
    fun recordEvent(event: StoreReviewRequestedAnalyticsEvent)
}

object NoOpStoreReviewAnalyticsReporter : StoreReviewAnalyticsReporter {
    override fun recordEvent(event: StoreReviewRequestedAnalyticsEvent) = Unit
}

class StoreReviewActivityProvider {
    private val activityReference = AtomicReference<ComponentActivity?>(null)

    fun updateActivity(activity: ComponentActivity) {
        activityReference.set(activity)
    }

    fun clearActivity(activity: ComponentActivity) {
        activityReference.compareAndSet(activity, null)
    }

    fun currentActivity(): ComponentActivity? {
        return activityReference.get()
    }
}

class StoreReviewRequestManager(
    context: Context,
    private val reviewLogDao: ReviewLogDao,
    private val storeReviewRequestStore: StoreReviewRequestStore,
    private val appVersion: String,
    private val installationIdProvider: () -> String?,
    private val analyticsReporter: StoreReviewAnalyticsReporter,
    private val zoneIdProvider: () -> ZoneId,
    private val currentTimeMillisProvider: () -> Long
) {
    private val reviewManager: ReviewManager = ReviewManagerFactory.create(context.applicationContext)
    private val mutex = Mutex()

    suspend fun requestStoreReviewIfEligible(activity: ComponentActivity): Boolean {
        return mutex.withLock {
            try {
                requestStoreReviewIfEligibleNow(activity = activity)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                Log.w(
                    storeReviewRequestLogTag,
                    "event=store_review_request_failed ${renderStoreReviewThrowableFields(error = error)}"
                )
                false
            }
        }
    }

    private suspend fun requestStoreReviewIfEligibleNow(activity: ComponentActivity): Boolean {
        if (isStoreReviewActivityResumed(activity = activity).not()) {
            return false
        }

        val nowMillis = currentTimeMillisProvider()
        val eligibility = determineStoreReviewRequestEligibility(
            reviewLogDao = reviewLogDao,
            storeReviewRequestStore = storeReviewRequestStore,
            nowMillis = nowMillis,
            zoneId = zoneIdProvider(),
            appVersion = appVersion
        )

        if (eligibility.isEligible.not()) {
            return false
        }
        if (isStoreReviewActivityResumed(activity = activity).not()) {
            return false
        }

        storeReviewRequestStore.saveRequestAttempt(
            requestedAtMillis = nowMillis,
            appVersion = appVersion
        )
        recordStoreReviewRequestedAnalytics(nowMillis = nowMillis)
        launchGooglePlayReviewFlow(activity = activity)
        return true
    }

    private fun recordStoreReviewRequestedAnalytics(nowMillis: Long) {
        try {
            analyticsReporter.recordEvent(
                event = StoreReviewRequestedAnalyticsEvent(
                    name = storeReviewRequestedAnalyticsEventName,
                    platform = storeReviewRequestedAnalyticsPlatform,
                    appVersion = appVersion,
                    localTimestampMillis = nowMillis,
                    installationId = installationIdProvider()?.trim()?.ifEmpty { null }
                )
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            Log.w(
                storeReviewRequestLogTag,
                "event=store_review_analytics_failed ${renderStoreReviewThrowableFields(error = error)}"
            )
        }
    }

    private suspend fun launchGooglePlayReviewFlow(activity: ComponentActivity) {
        try {
            requestAndLaunchGooglePlayReviewFlow(activity = activity)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            Log.w(
                storeReviewRequestLogTag,
                "event=store_review_play_flow_failed ${renderStoreReviewThrowableFields(error = error)}"
            )
        }
    }

    private suspend fun requestAndLaunchGooglePlayReviewFlow(activity: ComponentActivity) {
        withContext(Dispatchers.Main.immediate) {
            val reviewInfo = awaitReviewInfoTask(task = reviewManager.requestReviewFlow())
            if (isStoreReviewActivityResumed(activity = activity).not()) {
                Log.w(storeReviewRequestLogTag, "event=store_review_activity_not_resumed_before_launch")
                return@withContext
            }
            awaitReviewFlowCompletionTask(task = reviewManager.launchReviewFlow(activity, reviewInfo))
        }
    }
}

private fun isStoreReviewActivityResumed(activity: ComponentActivity): Boolean {
    return activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
}

private suspend fun awaitReviewInfoTask(task: Task<ReviewInfo>): ReviewInfo {
    return suspendCancellableCoroutine { continuation ->
        task.addOnCompleteListener { completedTask ->
            if (continuation.isActive.not()) {
                return@addOnCompleteListener
            }
            when {
                completedTask.isSuccessful -> continuation.resume(completedTask.result)
                completedTask.isCanceled -> continuation.resumeWithException(
                    IllegalStateException("Google Play review info request task was canceled.")
                )
                else -> continuation.resumeWithException(
                    completedTask.exception
                        ?: IllegalStateException("Google Play review info request task failed without an exception.")
                )
            }
        }
    }
}

private suspend fun awaitReviewFlowCompletionTask(task: Task<Void>) {
    suspendCancellableCoroutine<Unit> { continuation ->
        task.addOnCompleteListener { completedTask ->
            if (continuation.isActive.not()) {
                return@addOnCompleteListener
            }
            when {
                completedTask.isSuccessful -> continuation.resume(Unit)
                completedTask.isCanceled -> continuation.resumeWithException(
                    IllegalStateException("Google Play review launch task was canceled.")
                )
                else -> continuation.resumeWithException(
                    completedTask.exception
                        ?: IllegalStateException("Google Play review launch task failed without an exception.")
                )
            }
        }
    }
}

private fun renderStoreReviewThrowableFields(error: Throwable): String {
    return listOf(
        "errorClass" to error::class.java.name,
        "message" to error.message.orEmpty(),
        "reviewErrorCode" to (error as? ReviewException)?.errorCode?.toString().orEmpty()
    ).joinToString(separator = " ") { (name, value) ->
        "$name=$value"
    }
}
