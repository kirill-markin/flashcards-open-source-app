package com.flashcardsopensourceapp.data.local

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CloudPreferencesStoreMigrationContractTest {
    private lateinit var context: Context
    private lateinit var database: AppDatabase

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        clearLocalDatabaseSharedPreferences(context = context)
        database = createInMemoryAppDatabase(context = context)
    }

    @After
    fun tearDown() {
        if (::database.isInitialized) {
            database.close()
        }
        if (::context.isInitialized) {
            clearLocalDatabaseSharedPreferences(context = context)
        }
    }

    @Test
    fun cloudPreferencesStoreMigratesLegacyIdentityFromPreferencesIntoDatabaseSettings() = runBlocking {
        database.close()
        clearLocalDatabaseSharedPreferences(context = context)

        val legacyPreferences = context.getSharedPreferences("flashcards-cloud-metadata", Context.MODE_PRIVATE)
        legacyPreferences.edit()
            .putString("installation-id", "legacy-installation-id")
            .putString("cloud-state", "LINKED")
            .putString("linked-user-id", "legacy-user")
            .putString("linked-workspace-id", "legacy-workspace")
            .putString("linked-email", "legacy@example.com")
            .putString("active-workspace-id", "legacy-workspace")
            .putLong("updated-at-millis", 456L)
            .commit()

        database = createInMemoryAppDatabase(context = context)
        val migratedStore = CloudPreferencesStore(context = context, database = database)
        migratedStore.hydrateCloudSettingsFromDatabase()

        val migratedSettings = migratedStore.currentCloudSettings()
        val storedSettings = requireNotNull(database.appLocalSettingsDao().loadSettings()) {
            "Expected app_local_settings after legacy migration."
        }

        assertEquals("legacy-installation-id", migratedSettings.installationId)
        assertEquals("legacy-workspace", migratedSettings.activeWorkspaceId)
        assertEquals("legacy-installation-id", storedSettings.installationId)
        assertEquals("LINKED", storedSettings.cloudState)
        assertEquals("legacy-user", storedSettings.linkedUserId)
        assertEquals("legacy-workspace", storedSettings.linkedWorkspaceId)
        assertEquals("legacy@example.com", storedSettings.linkedEmail)
        assertEquals("legacy-workspace", storedSettings.activeWorkspaceId)
        assertEquals(456L, storedSettings.updatedAtMillis)
    }
}
