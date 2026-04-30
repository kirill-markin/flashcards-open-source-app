package com.flashcardsopensourceapp.feature.settings.workspace

import android.content.ContentResolver
import android.net.Uri
import com.flashcardsopensourceapp.data.local.model.WorkspaceExportData
import java.time.LocalDate

fun makeWorkspaceExportFilename(workspaceName: String, date: LocalDate): String {
    val slug = workspaceName
        .trim()
        .lowercase()
        .replace(Regex("[^a-z0-9]+"), "-")
        .replace(Regex("^-+|-+$"), "")
        .ifEmpty { "workspace" }

    return "$slug-cards-export-$date.csv"
}

fun makeWorkspaceCardsCsv(exportData: WorkspaceExportData): String {
    val lines = listOf("frontText,backText,tags") + exportData.cards.map { card ->
        listOf(
            escapeWorkspaceExportCsvCell(card.frontText),
            escapeWorkspaceExportCsvCell(card.backText),
            escapeWorkspaceExportCsvCell(card.tags.joinToString(separator = ", "))
        ).joinToString(separator = ",")
    }

    return lines.joinToString(separator = "\r\n") + "\r\n"
}

fun writeWorkspaceExportCsv(
    contentResolver: ContentResolver,
    uri: Uri,
    csv: String
) {
    val outputStream = requireNotNull(contentResolver.openOutputStream(uri, "wt")) {
        "Android export destination is unavailable for writing."
    }

    outputStream.bufferedWriter(charset = Charsets.UTF_8).use { writer ->
        writer.write(csv)
        writer.flush()
    }
}

private fun escapeWorkspaceExportCsvCell(value: String): String {
    val escapedValue = value.replace(oldValue = "\"", newValue = "\"\"")
    if (
        escapedValue.contains(",")
        || escapedValue.contains("\"")
        || escapedValue.contains("\n")
        || escapedValue.contains("\r")
    ) {
        return "\"$escapedValue\""
    }

    return escapedValue
}
