package com.flashcardsopensourceapp.app

import android.util.Log
import com.flashcardsopensourceapp.data.local.repository.ProgressRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

private const val progressContextRefreshControllerLogTag: String = "ProgressContextRefresh"

private fun logProgressContextRefreshFailure(
    message: String,
    error: Exception
) {
    runCatching {
        Log.e(
            progressContextRefreshControllerLogTag,
            message,
            error
        )
    }.onFailure {
        System.err.println(message)
        error.printStackTrace()
    }
}

class ProgressContextRefreshController(
    private val appScope: CoroutineScope,
    private val progressRepository: ProgressRepository
) {
    private val refreshRequests = Channel<Unit>(capacity = Channel.CONFLATED)

    init {
        appScope.launch {
            for (refreshRequest in refreshRequests) {
                try {
                    progressRepository.refreshSummaryIfInvalidated()
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    logProgressContextRefreshFailure(
                        message = "Failed to refresh invalidated progress summary.",
                        error = error
                    )
                }

                try {
                    progressRepository.refreshSeriesIfInvalidated()
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    logProgressContextRefreshFailure(
                        message = "Failed to refresh invalidated progress series.",
                        error = error
                    )
                }
            }
        }
    }

    fun refreshIfInvalidated() {
        refreshRequests.trySend(element = Unit)
    }
}
