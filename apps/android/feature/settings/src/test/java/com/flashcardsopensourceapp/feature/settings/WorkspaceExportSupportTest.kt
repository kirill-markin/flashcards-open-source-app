package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.data.local.model.WorkspaceExportCard
import com.flashcardsopensourceapp.data.local.model.WorkspaceExportData
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

class WorkspaceExportSupportTest {
    @Test
    fun csvEscapesQuotesCommasAndNewlines() {
        val exportData = WorkspaceExportData(
            workspaceId = "workspace-1",
            workspaceName = "Android Workspace",
            cards = listOf(
                WorkspaceExportCard(
                    frontText = "Front, \"quoted\"",
                    backText = "Line 1\nLine 2",
                    tags = listOf("ui", "android")
                )
            )
        )

        val csv = makeWorkspaceCardsCsv(exportData = exportData)

        assertEquals(
            "frontText,backText,tags\r\n" +
                "\"Front, \"\"quoted\"\"\",\"Line 1\nLine 2\",\"ui, android\"\r\n",
            csv
        )
    }

    @Test
    fun filenameUsesSlugifiedWorkspaceNameAndDate() {
        val filename = makeWorkspaceExportFilename(
            workspaceName = "  Android Native Workspace!  ",
            date = LocalDate.parse("2026-03-22")
        )

        assertEquals("android-native-workspace-cards-export-2026-03-22.csv", filename)
    }
}
