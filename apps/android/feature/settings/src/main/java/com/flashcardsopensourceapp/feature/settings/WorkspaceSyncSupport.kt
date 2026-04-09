package com.flashcardsopensourceapp.feature.settings

internal fun workspaceUpdatedOnAnotherDeviceMessage(strings: SettingsStringResolver): String {
    return strings.get(R.string.settings_workspace_auto_sync_changed)
}
