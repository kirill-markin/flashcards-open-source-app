package com.flashcardsopensourceapp.data.local.model.cloud

import java.net.URI
import kotlinx.serialization.Serializable

const val cloudAppleReturnUri: String = "com.nibomo.app:/auth/social/apple"

@Serializable
enum class CloudAppleBrowserStatus { COMPLETED, VERIFICATION_REQUIRED, DENIED }

@Serializable
data class CloudAppleBrowserReturn(val status: CloudAppleBrowserStatus, val handle: String)

data class CloudAppleBrowserLaunch(val localId: String, val url: String)

fun parseCloudAppleBrowserReturn(value: String): CloudAppleBrowserReturn {
    require(value.length <= 256) { "Apple sign-in return is too long." }
    val uri = try {
        URI(value)
    } catch (_: java.net.URISyntaxException) {
        throw IllegalArgumentException("Apple sign-in return is malformed.")
    }
    require(uri.scheme == "com.nibomo.app" && uri.rawAuthority == null &&
        uri.rawPath == "/auth/social/apple" && uri.rawQuery == null &&
        value.substringBefore('#') == cloudAppleReturnUri) {
        "Apple sign-in must return to the exact registered app URI."
    }
    val fields = requireNotNull(uri.rawFragment) { "Apple sign-in return is missing its status." }.split('&')
    require(fields.size == 2) { "Apple sign-in return must contain only status and one opaque handle." }
    val pairs = fields.map { field ->
        val parts = field.split('=')
        require(parts.size == 2) { "Apple sign-in return contains an invalid field." }
        parts[0] to parts[1]
    }
    require(pairs.map { it.first }.toSet().size == 2) { "Apple sign-in return repeats a field." }
    val parameters = pairs.toMap()
    val status = when (parameters["status"]) {
        "completed" -> CloudAppleBrowserStatus.COMPLETED
        "verification_required" -> CloudAppleBrowserStatus.VERIFICATION_REQUIRED
        "denied" -> CloudAppleBrowserStatus.DENIED
        else -> throw IllegalArgumentException("Apple sign-in return has an unsupported login status.")
    }
    val key = if (status == CloudAppleBrowserStatus.COMPLETED) "completion" else "attempt"
    require(parameters.keys == setOf("status", key)) { "Apple sign-in return contains unexpected fields." }
    val handle = requireNotNull(parameters[key])
    require(Regex("^[A-Za-z0-9_-]{43}$").matches(handle)) { "Apple sign-in return has an invalid opaque handle." }
    return CloudAppleBrowserReturn(status, handle)
}
