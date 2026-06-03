package com.flashcardsopensourceapp.data.local.cloud.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.entities.TagEntity
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SyncLocalStoreTagFilteringContractTest {
    private lateinit var runtime: SyncLocalStoreTestRuntime
    private val database: AppDatabase
        get() = runtime.database

    @Before
    fun setUp(): Unit {
        runtime = createSyncLocalStoreTestRuntime()
    }

    @After
    fun tearDown(): Unit {
        if (::runtime.isInitialized) {
            closeSyncLocalStoreTestRuntime(runtime = runtime)
        }
    }

    @Test
    fun loadCardTagsFiltersOutCrossWorkspaceTagLinks(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )
        database.workspaceDao().insertWorkspace(
            WorkspaceEntity(
                workspaceId = "workspace-2",
                name = "Other",
                createdAtMillis = 2L
            )
        )
        insertSyncContractCard(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId,
            cardId = "card-1"
        )
        database.tagDao().insertTags(
            listOf(
                TagEntity(
                    tagId = "tag-local",
                    workspaceId = syncLocalStoreContractWorkspaceId,
                    name = "local"
                ),
                TagEntity(
                    tagId = "tag-other",
                    workspaceId = "workspace-2",
                    name = "other"
                )
            )
        )
        database.tagDao().insertCardTags(
            listOf(
                CardTagEntity(cardId = "card-1", tagId = "tag-local"),
                CardTagEntity(cardId = "card-1", tagId = "tag-other")
            )
        )

        val cardTags = database.tagDao().loadCardTags(workspaceId = syncLocalStoreContractWorkspaceId)

        assertEquals(listOf(CardTagEntity(cardId = "card-1", tagId = "tag-local")), cardTags)
    }
}
