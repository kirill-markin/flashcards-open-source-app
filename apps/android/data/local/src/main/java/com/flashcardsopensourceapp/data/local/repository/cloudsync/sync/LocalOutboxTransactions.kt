package com.flashcardsopensourceapp.data.local.repository.cloudsync.sync

import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase

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
