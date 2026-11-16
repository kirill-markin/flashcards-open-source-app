package com.flashcardsopensourceapp.data.local.migrations

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.MediaTransferQueueEntity
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.database.migrations.createAppDatabaseMigrations
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

private const val databaseName = "migration-30-to-31-test.db"
private const val workspaceId = "workspace-1"
private const val legacyTimestampConflict =
    "Session creation retry does not match the committed immutable input. " +
        "sessionId=71cb476e-57a5-4fc2-8517-c9d8113855a5 conflictingFields=clientUpdatedAt"
private const val requestReference = " Reference: 549217db-4ab7-4193-b73d-3b4e41305de3"

@RunWith(AndroidJUnit4::class)
class AppDatabaseMigration30To31Test {
    @After
    fun tearDown() {
        deleteMigrationDatabaseFixture(
            context = ApplicationProvider.getApplicationContext(),
            databaseName = databaseName
        )
    }

    @Test
    fun requeuesOnlyFailedUploadsWithTheLegacyTimestampConflict() = runBlocking {
        val context: Context = ApplicationProvider.getApplicationContext()
        val recoverable = listOf(
            failedUpload(transferId = "timestamp-only", lastError = legacyTimestampConflict),
            failedUpload(transferId = "timestamp-with-reference", lastError = legacyTimestampConflict + requestReference)
        )
        val otherTransfers = listOf(
            failedUpload(transferId = "unrelated", lastError = "Managed media upload file is missing."),
            failedUpload(
                transferId = "mixed-fields",
                lastError = legacyTimestampConflict + ",lastOperationId" + requestReference
            ),
            failedUpload(
                transferId = "trailing-text",
                lastError = legacyTimestampConflict + requestReference + " unexpected"
            ),
            failedUpload(transferId = "download", lastError = legacyTimestampConflict).copy(kind = "download"),
            failedUpload(transferId = "succeeded", lastError = legacyTimestampConflict).copy(status = "succeeded")
        )

        val fixture = openDatabase(context = context)
        try {
            fixture.workspaceDao().insertWorkspace(
                workspace = WorkspaceEntity(workspaceId = workspaceId, name = "Workspace", createdAtMillis = 1_000L)
            )
            fixture.mediaTransferDao().upsertMediaTransfers(mediaTransfers = recoverable + otherTransfers)
            // The migration changes data only, so the current schema can stand in for version 30.
            fixture.openHelper.writableDatabase.version = 30
        } finally {
            fixture.close()
        }

        val database = openDatabase(context = context)
        try {
            assertEquals(31, database.openHelper.writableDatabase.version)
            val transferDao = database.mediaTransferDao()
            val dueUploads = transferDao.loadDueMediaTransfersByKind(
                workspaceId = workspaceId,
                kind = "upload",
                status = "queued",
                nowMillis = 0L,
                limit = 10
            )
            assertEquals(
                recoverable.map { transfer ->
                    transfer.copy(status = "queued", nextAttemptAtMillis = 0L, lastError = null)
                },
                dueUploads
            )
            otherTransfers.forEach { transfer ->
                assertEquals(transfer, transferDao.loadMediaTransfer(transferId = transfer.transferId))
            }
        } finally {
            database.close()
        }
    }

    private fun openDatabase(context: Context): AppDatabase {
        return Room.databaseBuilder(
            context = context,
            klass = AppDatabase::class.java,
            name = databaseName
        ).addMigrations(*createAppDatabaseMigrations()).build()
    }

    private fun failedUpload(transferId: String, lastError: String): MediaTransferQueueEntity {
        return MediaTransferQueueEntity(
            transferId = transferId,
            workspaceId = workspaceId,
            mediaAssetId = "asset-$transferId",
            kind = "upload",
            status = "failed",
            sha256 = "42".repeat(32),
            mimeType = "image/png",
            sizeBytes = 42L,
            localRelativePath = "uploads/image.png",
            attemptCount = 2,
            nextAttemptAtMillis = 60_000L,
            lastError = lastError,
            createdAtMillis = 1_000L,
            updatedAtMillis = 2_000L
        )
    }
}
