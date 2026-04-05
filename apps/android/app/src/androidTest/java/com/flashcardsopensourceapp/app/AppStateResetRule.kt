package com.flashcardsopensourceapp.app

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.rules.ExternalResource

private val testOnlyPreferenceNames: List<String> = listOf(
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

        runBlocking {
            application.awaitAppGraphStartup()
            application.appGraph.cloudAccountRepository.logout()
        }
        NotificationManagerCompat.from(context).cancelAll()
        clearTestOnlySharedPreferences(context = context)
    }

    private fun clearTestOnlySharedPreferences(context: Context) {
        testOnlyPreferenceNames.forEach { preferenceName ->
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
