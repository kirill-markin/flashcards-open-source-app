package com.flashcardsopensourceapp.data.local.cloud.remote.transport

import java.net.URLEncoder
import java.nio.charset.StandardCharsets

internal fun buildPaginatedCloudPath(basePath: String, cursor: String?): String {
    val query = if (cursor == null) {
        "limit=100"
    } else {
        "limit=100&cursor=${encodeCloudQueryValue(value = cursor)}"
    }
    return "$basePath?$query"
}

internal fun buildProgressSummaryCloudPath(timeZone: String): String {
    return buildString {
        append("/me/progress/summary?timeZone=")
        append(encodeCloudQueryValue(value = timeZone))
    }
}

internal fun buildProgressSeriesCloudPath(
    timeZone: String,
    from: String,
    to: String
): String {
    return buildString {
        append("/me/progress/series?timeZone=")
        append(encodeCloudQueryValue(value = timeZone))
        append("&from=")
        append(encodeCloudQueryValue(value = from))
        append("&to=")
        append(encodeCloudQueryValue(value = to))
    }
}

internal fun buildProgressReviewScheduleCloudPath(timeZone: String): String {
    return buildString {
        append("/me/progress/review-schedule?timeZone=")
        append(encodeCloudQueryValue(value = timeZone))
    }
}

internal fun buildProgressLeaderboardCloudPath(): String {
    return "/me/progress/leaderboard"
}

internal fun buildProgressStreakLeaderboardCloudPath(): String {
    return "/me/progress/leaderboards/streak"
}

internal fun buildProgressLeaderboardProfileCloudPath(publicProfileId: String): String {
    require(publicProfileId.isNotBlank()) {
        "Progress leaderboard profile publicProfileId must not be blank."
    }
    return "/me/progress/leaderboards/profiles/${encodeCloudPathSegment(value = publicProfileId)}"
}

internal fun buildCommunityProfileCloudPath(): String {
    return "/me/community/profile"
}

internal fun buildCommunityFriendInvitationsCloudPath(): String {
    return "/me/community/friend-invitations"
}

internal fun buildMediaAssetDownloadUrlCloudPath(
    workspaceId: String,
    mediaAssetId: String
): String {
    require(workspaceId.isNotBlank()) {
        "Media asset download URL path requires a workspace id."
    }
    require(mediaAssetId.isNotBlank()) {
        "Media asset download URL path requires a media asset id."
    }
    return "/workspaces/${encodeCloudPathSegment(value = workspaceId)}" +
        "/media-assets/${encodeCloudPathSegment(value = mediaAssetId)}/download-url"
}

internal fun buildWorkspacePackageImportPreviewCloudPath(workspaceId: String): String {
    require(workspaceId.isNotBlank()) {
        "Workspace package import preview path requires a workspace id."
    }
    return "/workspaces/${encodeCloudPathSegment(value = workspaceId)}/packages/import/preview"
}

internal fun buildWorkspacePackageImportCloudPath(workspaceId: String): String {
    require(workspaceId.isNotBlank()) {
        "Workspace package import path requires a workspace id."
    }
    return "/workspaces/${encodeCloudPathSegment(value = workspaceId)}/packages/import"
}

internal fun buildWorkspacePackageExportPreviewCloudPath(workspaceId: String): String {
    require(workspaceId.isNotBlank()) {
        "Workspace package export preview path requires a workspace id."
    }
    return "/workspaces/${encodeCloudPathSegment(value = workspaceId)}/packages/export/preview"
}

internal fun buildWorkspacePackageExportCloudPath(workspaceId: String): String {
    require(workspaceId.isNotBlank()) {
        "Workspace package export path requires a workspace id."
    }
    return "/workspaces/${encodeCloudPathSegment(value = workspaceId)}/packages/export"
}

private fun encodeCloudQueryValue(value: String): String {
    return URLEncoder.encode(value, StandardCharsets.UTF_8)
}

private fun encodeCloudPathSegment(value: String): String {
    return URLEncoder.encode(value, StandardCharsets.UTF_8)
        .replace(oldValue = "+", newValue = "%20")
}
