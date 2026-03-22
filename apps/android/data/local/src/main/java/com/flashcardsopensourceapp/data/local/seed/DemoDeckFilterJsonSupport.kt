package com.flashcardsopensourceapp.data.local.seed

import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import org.json.JSONArray
import org.json.JSONObject

fun encodeDeckFilterDefinition(filterDefinition: DeckFilterDefinition): String {
    val jsonObject = JSONObject()
    val effortArray = JSONArray()
    val tagArray = JSONArray()

    filterDefinition.effortLevels.forEach { effortLevel ->
        effortArray.put(effortLevel.name)
    }
    filterDefinition.tags.forEach { tag ->
        tagArray.put(tag)
    }

    jsonObject.put("version", filterDefinition.version)
    jsonObject.put("effortLevels", effortArray)
    jsonObject.put("tags", tagArray)

    return jsonObject.toString()
}
