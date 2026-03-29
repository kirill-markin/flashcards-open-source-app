package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudAccountUiSupportTest {
    @Test
    fun buildCurrentWorkspaceItemsSelectsOnlyActiveWorkspaceIdWhenNamesMatch() {
        val items = buildCurrentWorkspaceItems(
            activeWorkspaceId = "workspace-2",
            workspaces = listOf(
                CloudWorkspaceSummary(
                    workspaceId = "workspace-1",
                    name = "Personal",
                    createdAtMillis = 1L,
                    isSelected = false
                ),
                CloudWorkspaceSummary(
                    workspaceId = "workspace-2",
                    name = "Personal",
                    createdAtMillis = 2L,
                    isSelected = false
                ),
                CloudWorkspaceSummary(
                    workspaceId = "workspace-3",
                    name = "Personal",
                    createdAtMillis = 3L,
                    isSelected = false
                )
            )
        )

        assertEquals(
            listOf("workspace-2"),
            items.filter { item -> item.isSelected }.map(CurrentWorkspaceItemUiState::workspaceId)
        )
        assertEquals("workspace-3", items.first().workspaceId)
    }

    @Test
    fun buildCurrentWorkspaceItemsFallsBackToFirstSelectedWorkspaceWhenActiveWorkspaceIsMissing() {
        val items = buildCurrentWorkspaceItems(
            activeWorkspaceId = null,
            workspaces = listOf(
                CloudWorkspaceSummary(
                    workspaceId = "workspace-1",
                    name = "Personal",
                    createdAtMillis = 1L,
                    isSelected = true
                ),
                CloudWorkspaceSummary(
                    workspaceId = "workspace-2",
                    name = "Personal",
                    createdAtMillis = 2L,
                    isSelected = true
                )
            )
        )

        assertEquals(
            listOf("workspace-1"),
            items.filter { item -> item.isSelected }.map(CurrentWorkspaceItemUiState::workspaceId)
        )
        assertFalse(items.first { item -> item.workspaceId == "workspace-2" }.isSelected)
    }

    @Test
    fun buildCurrentWorkspaceItemsKeepsSameNameWorkspaceSubtitlesDistinct() {
        val items = buildCurrentWorkspaceItems(
            activeWorkspaceId = "workspace-2",
            workspaces = listOf(
                CloudWorkspaceSummary(
                    workspaceId = "workspace-1",
                    name = "Personal",
                    createdAtMillis = 1L,
                    isSelected = false
                ),
                CloudWorkspaceSummary(
                    workspaceId = "workspace-2",
                    name = "Personal",
                    createdAtMillis = 2L,
                    isSelected = true
                )
            )
        ).filterNot(CurrentWorkspaceItemUiState::isCreateNew)

        assertEquals(2, items.size)
        assertTrue(items.all { item -> item.subtitle.isNotBlank() })
        assertNotEquals(items[0].subtitle, items[1].subtitle)
    }

    @Test
    fun buildCurrentWorkspaceItemsSortsNewestWorkspaceFirst() {
        val items = buildCurrentWorkspaceItems(
            activeWorkspaceId = "workspace-1",
            workspaces = listOf(
                CloudWorkspaceSummary(
                    workspaceId = "workspace-1",
                    name = "Older",
                    createdAtMillis = 1L,
                    isSelected = true
                ),
                CloudWorkspaceSummary(
                    workspaceId = "workspace-2",
                    name = "Newest",
                    createdAtMillis = 2L,
                    isSelected = false
                )
            )
        ).filterNot(CurrentWorkspaceItemUiState::isCreateNew)

        assertEquals(listOf("workspace-2", "workspace-1"), items.map(CurrentWorkspaceItemUiState::workspaceId))
    }

    @Test
    fun buildCloudPostAuthWorkspaceItemsSelectsOnlyActiveWorkspaceIdWhenNamesMatch() {
        val items = buildCloudPostAuthWorkspaceItems(
            activeWorkspaceId = "workspace-2",
            workspaces = listOf(
                CloudWorkspaceSummary(
                    workspaceId = "workspace-1",
                    name = "Personal",
                    createdAtMillis = 1L,
                    isSelected = false
                ),
                CloudWorkspaceSummary(
                    workspaceId = "workspace-2",
                    name = "Personal",
                    createdAtMillis = 2L,
                    isSelected = false
                )
            )
        ).filterNot(CurrentWorkspaceItemUiState::isCreateNew)

        assertEquals(
            listOf("workspace-2"),
            items.filter(CurrentWorkspaceItemUiState::isSelected).map(CurrentWorkspaceItemUiState::workspaceId)
        )
        assertEquals("workspace-2", items.first().workspaceId)
        assertNotEquals(items[0].subtitle, items[1].subtitle)
    }

    @Test
    fun buildAutomaticWorkspaceSelectionUsesActiveWorkspaceIdBeforeServerSelectedFlag() {
        val selection = buildAutomaticWorkspaceSelection(
            activeWorkspaceId = "workspace-2",
            workspaces = listOf(
                CloudWorkspaceSummary(
                    workspaceId = "workspace-1",
                    name = "Personal",
                    createdAtMillis = 1L,
                    isSelected = true
                ),
                CloudWorkspaceSummary(
                    workspaceId = "workspace-2",
                    name = "Personal",
                    createdAtMillis = 2L,
                    isSelected = false
                )
            )
        )

        assertEquals(
            CloudWorkspaceLinkSelection.Existing(workspaceId = "workspace-2"),
            selection
        )
    }

    @Test
    fun buildAutomaticWorkspaceSelectionRequiresUniqueServerSelectedWorkspaceWhenActiveIdIsMissing() {
        val selection = buildAutomaticWorkspaceSelection(
            activeWorkspaceId = null,
            workspaces = listOf(
                CloudWorkspaceSummary(
                    workspaceId = "workspace-1",
                    name = "Personal",
                    createdAtMillis = 1L,
                    isSelected = true
                ),
                CloudWorkspaceSummary(
                    workspaceId = "workspace-2",
                    name = "Personal",
                    createdAtMillis = 2L,
                    isSelected = true
                )
            )
        )

        assertNull(selection)
    }
}
