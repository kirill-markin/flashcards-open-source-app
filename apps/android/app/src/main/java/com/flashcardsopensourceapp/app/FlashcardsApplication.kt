package com.flashcardsopensourceapp.app

import android.app.Application
import com.flashcardsopensourceapp.app.di.AppGraph

class FlashcardsApplication : Application() {
    lateinit var appGraph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        recreateAppGraph()
    }

    fun closeAppGraph() {
        appGraph.close()
    }

    fun recreateAppGraph() {
        appGraph = AppGraph(context = this)
    }
}
