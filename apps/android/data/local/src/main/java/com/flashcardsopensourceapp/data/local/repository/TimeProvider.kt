package com.flashcardsopensourceapp.data.local.repository

import java.time.ZoneId

interface TimeProvider {
    fun currentZoneId(): ZoneId
    fun currentTimeMillis(): Long
}

object SystemTimeProvider : TimeProvider {
    override fun currentZoneId(): ZoneId {
        return ZoneId.systemDefault()
    }

    override fun currentTimeMillis(): Long {
        return System.currentTimeMillis()
    }
}
