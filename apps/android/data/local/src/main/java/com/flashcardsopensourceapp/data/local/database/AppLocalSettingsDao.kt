package com.flashcardsopensourceapp.data.local.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface AppLocalSettingsDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSettings(settings: AppLocalSettingsEntity)

    @Update
    suspend fun updateSettings(settings: AppLocalSettingsEntity)

    @Query("SELECT * FROM app_local_settings WHERE settingsId = 1 LIMIT 1")
    fun observeSettings(): Flow<AppLocalSettingsEntity?>

    @Query("SELECT * FROM app_local_settings WHERE settingsId = 1 LIMIT 1")
    suspend fun loadSettings(): AppLocalSettingsEntity?

    @Query("DELETE FROM app_local_settings")
    suspend fun deleteAllSettings()
}
