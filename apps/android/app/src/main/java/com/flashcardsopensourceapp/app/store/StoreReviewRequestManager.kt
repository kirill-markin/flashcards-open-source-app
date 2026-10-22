package com.flashcardsopensourceapp.app.store

import android.content.Context
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.lifecycle.Lifecycle
import com.flashcardsopensourceapp.core.observability.analytics.Analytics
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.data.local.database.review.ReviewLogDao
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
    private val analytics: Analytics,
    private val zoneIdProvider: () -> ZoneId,
    private val currentTimeMillisProvider: () -> Long
) {
    private val reviewManager: ReviewManager = ReviewManagerFactory.create(context.applicationContext)
    private val mutex = Mutex()

    suspend fun requestStoreReviewIfEligible(
        activity: ComponentActivity,
        canPresent: () -> Boolean
    ): Boolean {
        return mutex.withLock {
            try {
                requestStoreReviewIfEligibleNow(activity = activity, canPresent = canPresent)
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

    private suspend fun requestStoreReviewIfEligibleNow(
        activity: ComponentActivity,
        canPresent: () -> Boolean
    ): Boolean {
        if (isStoreReviewActivityResumed(activity = activity).not() || !canPresent()) {
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
        if (isStoreReviewActivityResumed(activity = activity).not() || !canPresent()) {
            return false
        }

        launchGooglePlayReviewFlow(activity = activity, canPresent = canPresent)
        return true
    }

    private suspend fun launchGooglePlayReviewFlow(
        activity: ComponentActivity,
        canPresent: () -> Boolean
    ) {
        try {
            requestAndLaunchGooglePlayReviewFlow(activity = activity, canPresent = canPresent)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            Log.w(
                storeReviewRequestLogTag,
                "event=store_review_play_flow_failed ${renderStoreReviewThrowableFields(error = error)}"
            )
        }
    }

    private suspend fun requestAndLaunchGooglePlayReviewFlow(
        activity: ComponentActivity,
        canPresent: () -> Boolean
    ) {
        withContext(Dispatchers.Main.immediate) {
            val reviewInfo = awaitReviewInfoTask(task = reviewManager.requestReviewFlow())
            if (isStoreReviewActivityResumed(activity = activity).not()) {
                Log.w(storeReviewRequestLogTag, "event=store_review_activity_not_resumed_before_launch")
                return@withContext
            }
            if (!canPresent()) return@withContext
            val nowMillis = currentTimeMillisProvider()
            storeReviewRequestStore.saveRequestAttempt(
                requestedAtMillis = nowMillis,
                appVersion = appVersion
            )
            analytics.track(event = AnalyticsEvent.StoreReviewRequested)
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
