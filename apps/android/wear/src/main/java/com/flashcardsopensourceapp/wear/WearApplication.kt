package com.flashcardsopensourceapp.wear

import android.app.Application

class WearApplication : Application() {
    lateinit var appGraph: WearAppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        appGraph = WearAppGraph(context = this)
    }
}
