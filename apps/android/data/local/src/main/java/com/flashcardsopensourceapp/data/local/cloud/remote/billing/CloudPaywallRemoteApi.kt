package com.flashcardsopensourceapp.data.local.cloud.remote.billing

import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPaywallImpression
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPaywallState
import com.flashcardsopensourceapp.data.local.model.cloud.parseCloudPaywallImpression
import com.flashcardsopensourceapp.data.local.model.cloud.parseCloudPaywallState

internal class CloudPaywallRemoteApi(private val httpClient: CloudJsonHttpClient) {
    suspend fun load(apiBaseUrl: String, authorizationHeader: String): CloudPaywallState =
        parseCloudPaywallState(httpClient.getJson(apiBaseUrl, "/me/paywall-state", authorizationHeader))

    suspend fun record(apiBaseUrl: String, authorizationHeader: String, impression: CloudPaywallImpression): CloudPaywallState {
        val body = impression.toJson()
        parseCloudPaywallImpression(body)
        return parseCloudPaywallState(httpClient.postJson(apiBaseUrl, "/me/paywall-shown", authorizationHeader, body))
    }
}
