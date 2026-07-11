package com.flashcardsopensourceapp.app.notifications

import kotlinx.coroutines.sync.Mutex

class NotificationDeliveryGate {
    private val mutex = Mutex()

    suspend fun <Result> runExclusive(action: suspend () -> Result): Result {
        mutex.lock()
        return try {
            action()
        } finally {
            mutex.unlock()
        }
    }
}
