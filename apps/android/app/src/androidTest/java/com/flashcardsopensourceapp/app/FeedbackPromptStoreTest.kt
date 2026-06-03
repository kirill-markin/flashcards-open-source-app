package com.flashcardsopensourceapp.app

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.flashcardsopensourceapp.data.local.model.CloudFeedbackState
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FeedbackPromptStoreTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val store = SharedPreferencesFeedbackPromptStore(context = context)

    @Before
    fun clearPreferencesBeforeTest() {
        clearFeedbackPromptPreferences()
    }

    @After
    fun clearPreferencesAfterTest() {
        clearFeedbackPromptPreferences()
    }

    private fun clearFeedbackPromptPreferences() {
        context.getSharedPreferences(feedbackPromptPreferencesName, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
    }

    @Test
    fun promptStateAndDraftAreScopedByIdentityKey() {
        val userIdentityKey = FeedbackPromptIdentityKey(value = "user:user-1")
        val installationIdentityKey = FeedbackPromptIdentityKey(value = "installation:installation-1")

        store.recordAutomaticPromptShown(identityKey = userIdentityKey, nowMillis = 1_000L)
        store.saveDraftMessage(identityKey = userIdentityKey, message = "user draft")
        store.recordFeedbackSubmitted(
            identityKey = installationIdentityKey,
            feedbackState = CloudFeedbackState(
                automaticPromptCooldownDays = 30,
                lastAutomaticPromptShownAtMillis = null,
                lastFeedbackSubmittedAtMillis = 2_000L,
                nextAutomaticPromptAtMillis = 3_000L
            ),
            nowMillis = 2_000L
        )
        store.saveDraftMessage(identityKey = installationIdentityKey, message = "installation draft")

        val userState = store.loadState(identityKey = userIdentityKey)
        val installationState = store.loadState(identityKey = installationIdentityKey)

        assertEquals(1_000L, userState.lastAutomaticFeedbackPromptShownAtMillis)
        assertNull(userState.lastFeedbackSubmittedAtMillis)
        assertEquals("user draft", userState.draftMessage)
        assertNull(installationState.lastAutomaticFeedbackPromptShownAtMillis)
        assertEquals(2_000L, installationState.lastFeedbackSubmittedAtMillis)
        assertEquals(3_000L, installationState.nextAutomaticFeedbackPromptAtMillis)
        assertEquals("installation draft", installationState.draftMessage)
    }
}
