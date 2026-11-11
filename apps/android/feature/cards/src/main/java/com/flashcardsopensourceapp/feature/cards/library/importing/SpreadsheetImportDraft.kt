package com.flashcardsopensourceapp.feature.cards.library.importing

import androidx.annotation.StringRes
import com.flashcardsopensourceapp.data.local.model.cards.CardImportText
import com.flashcardsopensourceapp.feature.cards.R

internal const val spreadsheetImportMaximumCards: Int = 5_000

internal enum class SpreadsheetSeparator(val delimiter: String, @StringRes val label: Int) {
    TAB("\t", R.string.spreadsheet_import_separator_tab),
    COMMA(",", R.string.spreadsheet_import_separator_comma),
    NEWLINE("\n", R.string.spreadsheet_import_separator_newline),
    SEMICOLON(";", R.string.spreadsheet_import_separator_semicolon),
    CUSTOM("", R.string.spreadsheet_import_separator_custom)
}

internal data class SpreadsheetImportRow(val id: Int, val text: CardImportText) {
    val isValid: Boolean
        get() = text.frontText.isNotBlank() && text.backText.isNotBlank()
}

internal data class SpreadsheetImportDraft(
    val sourceText: String,
    val fieldSeparator: SpreadsheetSeparator,
    val rowSeparator: SpreadsheetSeparator,
    val customFieldSeparator: String,
    val customRowSeparator: String,
    val rows: List<SpreadsheetImportRow>,
    val exceedsCardLimit: Boolean
) {
    private val fieldDelimiter: String
        get() = if (fieldSeparator == SpreadsheetSeparator.CUSTOM) customFieldSeparator else fieldSeparator.delimiter

    private val rowDelimiter: String
        get() = if (rowSeparator == SpreadsheetSeparator.CUSTOM) customRowSeparator else rowSeparator.delimiter

    val hasMissingDelimiter: Boolean
        get() = fieldDelimiter.isEmpty() || rowDelimiter.isEmpty()

    fun reparse(): SpreadsheetImportDraft {
        if (hasMissingDelimiter) return copy(rows = emptyList(), exceedsCardLimit = false)

        val field = fieldDelimiter
        val parsedRows = sourceText.replace("\r\n", "\n").replace('\r', '\n')
            .splitToSequence(rowDelimiter)
            .mapIndexedNotNull { index, record ->
                if (record.isBlank()) return@mapIndexedNotNull null
                SpreadsheetImportRow(
                    id = index,
                    text = CardImportText(
                        frontText = record.substringBefore(field).trim(),
                        backText = record.substringAfter(field, missingDelimiterValue = "").trim()
                    )
                )
            }
            .take(spreadsheetImportMaximumCards + 1)
            .toList()
        val exceedsLimit = parsedRows.size > spreadsheetImportMaximumCards
        return copy(rows = if (exceedsLimit) emptyList() else parsedRows, exceedsCardLimit = exceedsLimit)
    }
}

internal fun emptySpreadsheetImportDraft(): SpreadsheetImportDraft {
    return SpreadsheetImportDraft(
        sourceText = "",
        fieldSeparator = SpreadsheetSeparator.TAB,
        rowSeparator = SpreadsheetSeparator.NEWLINE,
        customFieldSeparator = "",
        customRowSeparator = "",
        rows = emptyList(),
        exceedsCardLimit = false
    )
}
