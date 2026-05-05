package com.flashcardsopensourceapp.data.local.repository

import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase

internal suspend fun <Result> runLocalOutboxMutationTransaction(
    database: AppDatabase,
    preferencesStore: CloudPreferencesStore,
    block: suspend () -> Result
): Result {
    return preferencesStore.runWithLocalOutboxMutationAllowed {
        database.withTransaction {
            block()
        }
    }
}
