package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import org.junit.Assert.assertEquals
import org.junit.Test

class CurrentWorkspaceResolverTest {
    @Test
    fun resolveCurrentWorkspacePrefersActiveWorkspaceId() {
        val workspaces = listOf(
            WorkspaceEntity(workspaceId = "workspace-1", name = "Personal", createdAtMillis = 1L),
            WorkspaceEntity(workspaceId = "workspace-2", name = "Personal", createdAtMillis = 2L)
        )

        val currentWorkspace = resolveCurrentWorkspace(
            activeWorkspaceId = "workspace-2",
            workspaces = workspaces
        )

        assertEquals("workspace-2", currentWorkspace?.workspaceId)
    }

    @Test
    fun resolveCurrentWorkspaceFallsBackToSingleLocalWorkspace() {
        val workspaces = listOf(
            WorkspaceEntity(workspaceId = "workspace-1", name = "Personal", createdAtMillis = 1L)
        )

        val currentWorkspace = resolveCurrentWorkspace(
            activeWorkspaceId = null,
            workspaces = workspaces
        )

        assertEquals("workspace-1", currentWorkspace?.workspaceId)
    }

    @Test
    fun resolveCurrentWorkspaceFailsWhenActiveWorkspaceIdDoesNotExistEvenWithSingleLocalWorkspace() {
        val workspaces = listOf(
            WorkspaceEntity(workspaceId = "workspace-1", name = "Personal", createdAtMillis = 1L)
        )

        val error = runCatching {
            resolveCurrentWorkspace(
                activeWorkspaceId = "workspace-missing",
                workspaces = workspaces
            )
        }.exceptionOrNull()

        requireNotNull(error) { "Expected an invalid active workspace error." }
        assertEquals(
            "Current workspace is invalid because activeWorkspaceId 'workspace-missing' does not exist locally. Local workspaces=[workspace-1]",
            error.message
        )
    }

    @Test
    fun resolveCurrentWorkspaceFailsWhenMultipleLocalWorkspacesHaveNoActiveWorkspaceId() {
        val workspaces = listOf(
            WorkspaceEntity(workspaceId = "workspace-1", name = "Older", createdAtMillis = 1L),
            WorkspaceEntity(workspaceId = "workspace-2", name = "Newer", createdAtMillis = 2L)
        )

        val error = runCatching {
            resolveCurrentWorkspace(
                activeWorkspaceId = null,
                workspaces = workspaces
            )
        }.exceptionOrNull()

        requireNotNull(error) { "Expected an ambiguity error." }
        assertEquals(
            "Current workspace is ambiguous because activeWorkspaceId is missing. Local workspaces=[workspace-1, workspace-2]",
            error.message
        )
    }

    @Test
    fun resolveCurrentWorkspaceFailsWhenActiveWorkspaceIdDoesNotExistAndStateIsAmbiguous() {
        val workspaces = listOf(
            WorkspaceEntity(workspaceId = "workspace-1", name = "Older", createdAtMillis = 1L),
            WorkspaceEntity(workspaceId = "workspace-2", name = "Newer", createdAtMillis = 2L)
        )

        val error = runCatching {
            resolveCurrentWorkspace(
                activeWorkspaceId = "workspace-missing",
                workspaces = workspaces
            )
        }.exceptionOrNull()

        requireNotNull(error) { "Expected an invalid active workspace error." }
        assertEquals(
            "Current workspace is invalid because activeWorkspaceId 'workspace-missing' does not exist locally. Local workspaces=[workspace-1, workspace-2]",
            error.message
        )
    }
}
