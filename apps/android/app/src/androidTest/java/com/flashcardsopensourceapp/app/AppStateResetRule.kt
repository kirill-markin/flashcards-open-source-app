package com.flashcardsopensourceapp.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.rules.ExternalResource
import java.io.File

private const val appDatabaseName: String = "flashcards-android.db"

private val appPreferenceNames: List<String> = listOf(
    "flashcards-ai-chat-history",
    "flashcards-ai-chat-preferences",
    "flashcards-ai-chat-guest-session",
    "flashcards-cloud-metadata",
    "flashcards-cloud-secrets",
    "flashcards-review-preferences"
)

class AppStateResetRule : ExternalResource() {
    override fun before() {
        resetAppState()
    }

    override fun after() {
        resetAppState()
    }

    private fun resetAppState() {
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()

        val context = ApplicationProvider.getApplicationContext<Context>()
        val application = context as FlashcardsApplication

        application.closeAppGraph()
        clearDatabase(context = context)
        clearSharedPreferences(context = context)
        application.recreateAppGraph()
    }

    private fun clearDatabase(context: Context) {
        val databasePath = context.getDatabasePath(appDatabaseName)
        val didDeleteDatabase = context.deleteDatabase(appDatabaseName)
        if (didDeleteDatabase.not() && databasePath.exists()) {
            throw IllegalStateException("Failed to delete database at ${databasePath.absolutePath}.")
        }
        deleteIfExists(file = File(databasePath.parentFile, "$appDatabaseName-shm"))
        deleteIfExists(file = File(databasePath.parentFile, "$appDatabaseName-wal"))
        deleteIfExists(file = File(databasePath.parentFile, "$appDatabaseName-journal"))
    }

    private fun clearSharedPreferences(context: Context) {
        appPreferenceNames.forEach { preferenceName ->
            val sharedPreferences = context.getSharedPreferences(preferenceName, Context.MODE_PRIVATE)
            val didCommitClear = sharedPreferences.edit().clear().commit()
            if (didCommitClear.not()) {
                throw IllegalStateException("Failed to clear shared preferences '$preferenceName'.")
            }
            val didDeletePreferences = context.deleteSharedPreferences(preferenceName)
            if (didDeletePreferences.not() && sharedPreferences.all.isNotEmpty()) {
                throw IllegalStateException("Failed to delete shared preferences '$preferenceName'.")
            }
        }
    }
}

private fun deleteIfExists(file: File) {
    if (file.exists().not()) {
        return
    }
    val didDelete = file.delete()
    if (didDelete.not()) {
        throw IllegalStateException("Failed to delete file at ${file.absolutePath}.")
    }
}
