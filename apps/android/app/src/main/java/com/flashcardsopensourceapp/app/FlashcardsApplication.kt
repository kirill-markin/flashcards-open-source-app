package com.flashcardsopensourceapp.app

import android.app.Application
import com.flashcardsopensourceapp.app.di.AppGraph
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class FlashcardsApplication : Application() {
    private val appGraphResetMutex = Mutex()

    val appGraph: AppGraph
        get() = requireNotNull(appGraphHolder) { "App graph is unavailable." }

    private var appGraphHolder: AppGraph? = null

    override fun onCreate() {
        super.onCreate()
        appGraphHolder = AppGraph(context = this)
    }

    suspend fun closeAppGraph() {
        appGraphResetMutex.withLock {
            val existingAppGraph = appGraphHolder ?: return@withLock
            appGraphHolder = null
            existingAppGraph.close()
        }
    }

    suspend fun recreateAppGraphAndAwaitStartup() {
        appGraphResetMutex.withLock {
            val existingAppGraph = appGraphHolder
            appGraphHolder = null
            existingAppGraph?.close()

            val newAppGraph = AppGraph(context = this)
            appGraphHolder = newAppGraph
            newAppGraph.awaitStartup()
        }
    }
}
