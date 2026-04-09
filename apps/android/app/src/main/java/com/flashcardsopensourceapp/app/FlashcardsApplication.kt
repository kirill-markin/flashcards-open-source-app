package com.flashcardsopensourceapp.app

import android.app.Application
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.locale.AppLocaleInitializer

class FlashcardsApplication : Application() {
    lateinit var appGraph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        AppLocaleInitializer(context = this).initializeIfNeeded()
        recreateAppGraph()
    }

    fun closeAppGraph() {
        appGraph.close()
    }

    fun recreateAppGraph() {
        if (this::appGraph.isInitialized) {
            appGraph.close()
        }
        appGraph = AppGraph(context = this)
    }

    suspend fun awaitAppGraphStartup() {
        appGraph.awaitStartup()
    }
}
