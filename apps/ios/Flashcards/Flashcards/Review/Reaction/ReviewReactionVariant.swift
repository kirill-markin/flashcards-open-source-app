import Foundation

enum ReviewReactionVariant: CaseIterable, Hashable, Sendable {
    case againRainCloud
    case againTornado
    case againWindFace
    case againSnowflake
    case againSnailCrawl
    case againTurtle
    case againWiltedFlower
    case againSpider
    case againRat
    case againWormWiggle
    case hardTiger
    case hardTRex
    case hardShark
    case hardOxCharge
    case hardRacehorseGallop
    case hardSnake
    case hardVolcanoEruption
    case hardScorpion
    case hardPawPrints
    case hardRooster
    case goodOtter
    case goodOwl
    case goodRabbit
    case goodSeal
    case goodServiceDog
    case goodPoodle
    case goodChimpanzee
    case goodWhale
    case goodPeacock
    case goodPig
    case easySunrise
    case easySunriseOverMountains
    case easyRoseBloom
    case easyPeace
    case easyPlant
    case easyRainbowStreak
    case easyPhoenixRise
    case easyUnicornFlyby
    case fallbackCrownBounce

    var debugIdentifier: String {
        String(describing: self)
    }

    var animationDurationSeconds: Double {
        switch self {
        case .againWindFace:
            return 1.600
        case .hardTRex:
            return 1.550
        case .hardRacehorseGallop:
            return 1.20
        case .easySunriseOverMountains:
            return 1.200
        case .goodRabbit:
            return 1.333
        case .easyRoseBloom:
            return 2.40
        case .againSpider:
            return 2.400
        case .goodPeacock:
            return 1.333
        case .againTornado:
            return 1.45
        case .hardOxCharge:
            return 1.55
        case .hardScorpion:
            return 1.800
        case .hardPawPrints, .fallbackCrownBounce:
            return 1.65
        case .easyRainbowStreak:
            return 2.00
        case .hardVolcanoEruption:
            return 2.05
        case .againWiltedFlower:
            return 2.40
        case .goodSeal:
            return 2.567
        case .goodWhale:
            return 2.633
        case .againRat:
            return 2.633
        case .againSnailCrawl:
            return 2.70
        case .hardRooster:
            return 2.850
        case .goodPoodle:
            return 2.800
        case .goodOwl:
            return 2.833
        case .goodOtter, .goodServiceDog:
            return 3.000
        case .easyPeace:
            return 3.167
        case .hardShark:
            return 3.200
        case .againRainCloud, .hardSnake:
            return 3.267
        case .againTurtle:
            return 3.400
        case .goodPig:
            return 3.567
        case .goodChimpanzee:
            return 3.833
        case .easyPhoenixRise:
            return 3.933
        case .easyUnicornFlyby:
            return 3.80
        case .againSnowflake, .hardTiger, .easySunrise, .easyPlant:
            return 4.200
        case .againWormWiggle:
            return 4.267
        }
    }

    var cleanupDelayNanoseconds: UInt64 {
        let cleanupDelaySeconds = self.animationDurationSeconds + 0.08
        return UInt64(cleanupDelaySeconds * 1_000_000_000)
    }
}
