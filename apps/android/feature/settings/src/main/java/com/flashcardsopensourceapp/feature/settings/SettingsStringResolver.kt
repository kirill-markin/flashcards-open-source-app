package com.flashcardsopensourceapp.feature.settings

import android.content.Context
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import com.flashcardsopensourceapp.data.local.model.AppMetadataStorage
import com.flashcardsopensourceapp.data.local.model.AppMetadataSyncStatus
import java.util.Locale

interface SettingsStringResolver {
    fun get(@StringRes stringResId: Int, vararg formatArgs: Any): String

    fun getQuantity(@PluralsRes pluralsResId: Int, quantity: Int, vararg formatArgs: Any): String

    fun locale(): Locale
}

internal class AndroidSettingsStringResolver(
    private val context: Context
) : SettingsStringResolver {
    override fun get(@StringRes stringResId: Int, vararg formatArgs: Any): String {
        return context.getString(stringResId, *formatArgs)
    }

    override fun getQuantity(@PluralsRes pluralsResId: Int, quantity: Int, vararg formatArgs: Any): String {
        return context.resources.getQuantityString(pluralsResId, quantity, *formatArgs)
    }

    override fun locale(): Locale {
        return context.resources.configuration.locales[0] ?: Locale.getDefault()
    }
}

internal fun createSettingsStringResolver(context: Context): SettingsStringResolver {
    return AndroidSettingsStringResolver(context = context.applicationContext)
}

internal fun SettingsStringResolver.resolveWorkspaceName(workspaceName: String?): String {
    return workspaceName ?: get(R.string.settings_unavailable)
}

internal fun SettingsStringResolver.resolveAppMetadataStorageLabel(storage: AppMetadataStorage): String {
    return when (storage) {
        AppMetadataStorage.ROOM_SQLITE -> get(R.string.settings_device_storage_room_sqlite)
    }
}

internal fun SettingsStringResolver.resolveAppMetadataSyncStatusText(status: AppMetadataSyncStatus): String {
    return when (status) {
        AppMetadataSyncStatus.NotConnected -> get(R.string.settings_sync_status_not_connected)
        AppMetadataSyncStatus.SignInCompleteChooseWorkspace -> {
            get(R.string.settings_sync_status_sign_in_complete_choose_workspace)
        }

        AppMetadataSyncStatus.GuestAiSession -> get(R.string.settings_cloud_status_guest_ai_session)
        AppMetadataSyncStatus.Synced -> get(R.string.settings_sync_status_synced)
        AppMetadataSyncStatus.Syncing -> get(R.string.settings_sync_status_syncing)
        is AppMetadataSyncStatus.Message -> status.text
    }
}
