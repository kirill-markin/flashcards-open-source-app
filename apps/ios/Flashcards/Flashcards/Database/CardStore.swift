import Foundation

struct ReviewQuerySQL {
    let clause: String
    let values: [SQLiteValue]
}

struct CardStore {
    let core: DatabaseCore
}
