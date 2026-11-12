package com.flashcardsopensourceapp.data.local.model.ai

sealed interface AiImportSourceInput {
    /** The pasted text goes to AI chat as one plain-text attachment named [attachmentFileName]. */
    data class PastedText(val attachmentFileName: String) : AiImportSourceInput

    /** [formats] is shown as is in every language; [fileExtensions] are lowercase, without the dot. */
    data class Files(
        val formats: String,
        val fileExtensions: Set<String>
    ) : AiImportSourceInput
}

/**
 * Keep a row per source brand even when file formats overlap. Every row hands off to the same AI import flow.
 * [brandName] is never translated and is null only for the catch-all row.
 */
enum class AiImportSource(
    val id: String,
    val brandName: String?,
    val input: AiImportSourceInput
) {
    QUIZLET(
        id = "quizlet",
        brandName = "Quizlet",
        input = AiImportSourceInput.PastedText(attachmentFileName = "quizlet.txt")
    ),
    ANKI(
        id = "anki",
        brandName = "Anki",
        input = AiImportSourceInput.Files(formats = ".apkg, .colpkg", fileExtensions = setOf("apkg", "colpkg"))
    ),
    NOJI(
        id = "noji",
        brandName = "Noji",
        input = AiImportSourceInput.Files(formats = ".csv, .ofc", fileExtensions = setOf("csv", "ofc"))
    ),
    KNOWT(
        id = "knowt",
        brandName = "Knowt",
        input = AiImportSourceInput.Files(formats = ".pdf", fileExtensions = setOf("pdf"))
    ),
    REMNOTE(
        id = "remnote",
        brandName = "RemNote",
        input = AiImportSourceInput.Files(formats = ".apkg, .md, .txt", fileExtensions = setOf("apkg", "md", "txt"))
    ),
    BRAINSCAPE(
        id = "brainscape",
        brandName = "Brainscape",
        input = AiImportSourceInput.Files(formats = ".csv", fileExtensions = setOf("csv"))
    ),
    STUDYSMARTER(
        id = "studysmarter",
        brandName = "StudySmarter",
        input = AiImportSourceInput.Files(formats = ".csv", fileExtensions = setOf("csv"))
    ),
    CRAM(
        id = "cram",
        brandName = "Cram",
        input = AiImportSourceInput.Files(formats = ".csv", fileExtensions = setOf("csv"))
    ),
    MOCHI(
        id = "mochi",
        brandName = "Mochi",
        input = AiImportSourceInput.Files(formats = ".mochi", fileExtensions = setOf("mochi"))
    ),
    SUPERMEMO(
        id = "supermemo",
        brandName = "SuperMemo",
        input = AiImportSourceInput.Files(formats = ".xml", fileExtensions = setOf("xml"))
    ),
    ANKIAPP(
        id = "ankiapp",
        brandName = "AlgoApp (formerly AnkiApp)",
        input = AiImportSourceInput.Files(formats = ".zip, .xml", fileExtensions = setOf("zip", "xml"))
    ),
    OTHER(
        id = "other",
        brandName = null,
        input = AiImportSourceInput.Files(
            formats = "CSV, TXT, XLSX, PDF",
            fileExtensions = setOf("csv", "txt", "xlsx", "xls", "pdf", "json", "xml", "md", "docx", "zip")
        )
    )
}

fun aiImportSourceForId(id: String): AiImportSource {
    return requireNotNull(AiImportSource.entries.firstOrNull { source -> source.id == id }) {
        "Unknown AI import source id: $id"
    }
}
