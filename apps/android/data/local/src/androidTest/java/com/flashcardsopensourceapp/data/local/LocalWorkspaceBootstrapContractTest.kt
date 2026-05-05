package com.flashcardsopensourceapp.data.local

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.bootstrap.localWorkspaceName
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalWorkspaceBootstrapContractTest {
    private lateinit var runtime: LocalDatabaseTestRuntime
    private val database: AppDatabase
        get() = runtime.database

    @Before
    fun setUp() = runBlocking {
        runtime = createLocalDatabaseTestRuntime()
    }

    @After
    fun tearDown() {
        if (::runtime.isInitialized) {
            closeLocalDatabaseTestRuntime(runtime = runtime)
        }
    }

    @Test
    fun localWorkspaceBootstrapIsIdempotentAndCreatesEmptyState(): Unit = runBlocking {
        val firstWorkspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 100L)
        val secondWorkspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 200L)

        assertEquals(firstWorkspaceId, secondWorkspaceId)
        assertEquals(1, database.workspaceDao().countWorkspaces())
        assertEquals(localWorkspaceName, database.workspaceDao().loadAnyWorkspace()?.name)
        assertEquals(0, database.outboxDao().countOutboxEntries())
        assertNotNull(database.syncStateDao().loadSyncState(workspaceId = firstWorkspaceId))
        assertNotNull(
            database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings(workspaceId = firstWorkspaceId)
        )
        assertTrue(database.cardDao().observeCardsWithRelations().first().isEmpty())
        assertTrue(database.deckDao().observeDecks().first().isEmpty())
    }

    @Test
    fun workspaceRepositoryExposesDeviceDiagnosticsAndExportDataForEmptyWorkspace(): Unit = runBlocking {
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 100L)
        val workspaceRepository = createTestWorkspaceRepository(runtime = runtime)

        val diagnostics = workspaceRepository.observeDeviceDiagnostics().first()
        val exportData = workspaceRepository.loadWorkspaceExportData()

        assertEquals(workspaceId, diagnostics?.workspaceId)
        assertEquals(localWorkspaceName, diagnostics?.workspaceName)
        assertEquals(0, diagnostics?.outboxEntriesCount)
        assertEquals(null, diagnostics?.lastSyncCursor)
        assertEquals(null, diagnostics?.lastSyncAttemptAtMillis)

        assertEquals(workspaceId, exportData?.workspaceId)
        assertEquals(localWorkspaceName, exportData?.workspaceName)
        assertTrue(exportData?.cards?.isEmpty() == true)
    }
}
