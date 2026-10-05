package com.flashcardsopensourceapp.core.ui

import android.annotation.SuppressLint
import android.content.Context
import android.os.LocaleList
import org.xmlpull.v1.XmlPullParser
import java.util.Locale

@SuppressLint("DiscouragedApi")
fun loadAppSupportedLocalesFromXml(context: Context): LocaleList {
    // The canonical locale resource belongs to the host app, whose R is unavailable to this module.
    val resourceId: Int = context.resources.getIdentifier("locales_config", "xml", context.packageName)
    check(resourceId != 0) {
        "Android locales_config.xml is missing for app UI locale resolution."
    }
    val parser = context.resources.getXml(resourceId)
    val supportedLocales: MutableList<Locale> = mutableListOf()
    try {
        while (parser.next() != XmlPullParser.END_DOCUMENT) {
            if (parser.eventType == XmlPullParser.START_TAG && parser.name == "locale") {
                val languageTag: String = parser.getAttributeValue(
                    "http://schemas.android.com/apk/res/android",
                    "name"
                )?.trim().orEmpty()
                check(languageTag.isNotEmpty()) {
                    "Android locales_config.xml locale entry is missing android:name."
                }
                val locale: Locale = Locale.forLanguageTag(languageTag)
                check(locale.language.isNotBlank()) {
                    "Unsupported Android locale tag in locales_config.xml: $languageTag"
                }
                supportedLocales += locale
            }
        }
    } finally {
        parser.close()
    }
    return LocaleList(*supportedLocales.toTypedArray())
}
