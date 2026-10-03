package com.flashcardsopensourceapp.app.store

fun googlePlaySubscriptionManagementUrl(packageName: String): String {
    return "https://play.google.com/store/account/subscriptions?sku=$googlePlayPremiumProductId&package=$packageName"
}
