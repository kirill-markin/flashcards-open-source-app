pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)

    repositories {
        google()
        mavenCentral()
        exclusiveContent {
            forRepository {
                ivy {
                    name = "RaTeXFork"
                    url = uri("https://github.com/kirill-markin/RaTeX/releases/download/fork-packages-0.1.15-1")
                    patternLayout {
                        ivy("[module]-[revision].ivy.xml")
                        artifact("[artifact]-[revision].[ext]")
                    }
                    metadataSources {
                        ivyDescriptor()
                    }
                }
            }
            filter {
                includeModule("io.github.kirill-markin", "ratex-android")
            }
        }
    }
}

rootProject.name = "flashcards-open-source-app-android"

include(":app")
include(":baselineprofile")
include(":core:ui")
include(":core:observability")
include(":data:local")
include(":feature:review")
include(":feature:cards")
include(":feature:ai")
include(":feature:friendinvite")
include(":feature:progress")
include(":feature:settings")
