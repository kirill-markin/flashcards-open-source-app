package com.flashcardsopensourceapp.feature.settings.workspace

import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver

internal fun workspaceUpdatedOnAnotherDeviceMessage(strings: SettingsStringResolver): String {
    return strings.get(R.string.settings_workspace_auto_sync_changed)
}
