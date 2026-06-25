import Foundation

struct StatsEnvelope: Decodable {
    let meta: FeedMeta?
    let results: [MatchStat]
}

struct GamesEnvelope: Decodable {
    let response: [LiveGame]?
    let games: [LiveGame]?

    var rows: [LiveGame] { response ?? games ?? [] }
}

struct FeedMeta: Decodable {
    let source: String?
    let rows: Int?
    let missingCompleted: Int?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case source, rows
        case missingCompleted = "missing_completed"
        case updatedAt = "updated_at"
    }
}

struct LiveGame: Decodable, Identifiable {
    let id: String?
    let homeTeamName: String?
    let awayTeamName: String?
    let homeScore: String?
    let awayScore: String?
    let finished: String?
    let timeElapsed: String?

    enum CodingKeys: String, CodingKey {
        case id
        case homeTeamName = "home_team_name_en"
        case awayTeamName = "away_team_name_en"
        case homeScore = "home_score"
        case awayScore = "away_score"
        case finished
        case timeElapsed = "time_elapsed"
    }
}

struct MatchStat: Decodable, Identifiable, Hashable {
    let matchId: String
    let espnEventId: String?
    let home: String
    let away: String
    let group: String?
    let localDate: String?
    let referee: String
    let refereeCountry: String?
    let homeFouls: Int
    let awayFouls: Int
    let homeOffsides: Int
    let awayOffsides: Int
    let yellowCards: Int
    let redCards: Int
    let penalties: Int
    let varReviews: Int
    let cardEvents: [CardEvent]
    let foulEvents: [FoulEvent]
    let varEvents: [VAREvent]
    let connectorLinks: [ConnectorLink]
    let source: String?
    let confidence: String?
    let statURL: String?

    var id: String { matchId }
    var totalFouls: Int { homeFouls + awayFouls }
    var totalCards: Int { yellowCards + redCards }
    var statusLabel: String { source == "espn-public-verified" ? "Verified final sheet" : "Awaiting final sheet" }
    var foulLeader: String {
        if homeFouls == awayFouls { return "Even" }
        return homeFouls > awayFouls ? home : away
    }
    var foulGap: Int { abs(homeFouls - awayFouls) }

    enum CodingKeys: String, CodingKey {
        case matchId = "match_id"
        case espnEventId = "espn_event_id"
        case home, away, group
        case localDate = "local_date"
        case referee
        case refereeCountry = "referee_country"
        case homeFouls = "home_fouls"
        case awayFouls = "away_fouls"
        case homeOffsides = "home_offsides"
        case awayOffsides = "away_offsides"
        case yellowCards = "yellow_cards"
        case redCards = "red_cards"
        case penalties
        case varReviews = "var_reviews"
        case cardEvents = "card_events"
        case foulEvents = "foul_events"
        case varEvents = "var_events"
        case connectorLinks = "connector_links"
        case source, confidence
        case statURL = "stat_url"
    }
}

struct CardEvent: Decodable, Identifiable, Hashable {
    let matchId: String?
    let team: String
    let playerName: String
    let minute: Int
    let card: String
    let reason: String?

    var id: String { "\(matchId ?? "")-\(team)-\(playerName)-\(minute)-\(card)" }

    enum CodingKeys: String, CodingKey {
        case matchId = "match_id"
        case team
        case playerName = "player_name"
        case minute, card, reason
    }
}

struct FoulEvent: Decodable, Identifiable, Hashable {
    let matchId: String?
    let team: String
    let opponent: String?
    let playerName: String
    let minute: Int
    let type: String?

    var id: String { "\(matchId ?? "")-\(team)-\(playerName)-\(minute)-\(type ?? "")" }

    enum CodingKeys: String, CodingKey {
        case matchId = "match_id"
        case team, opponent
        case playerName = "player_name"
        case minute, type
    }
}

struct VAREvent: Decodable, Identifiable, Hashable {
    let team: String?
    let playerName: String?
    let minute: Int
    let decision: String

    var id: String { "\(team ?? "")-\(playerName ?? "")-\(minute)-\(decision)" }

    enum CodingKeys: String, CodingKey {
        case team
        case playerName = "player_name"
        case minute, decision
    }
}

struct ConnectorLink: Decodable, Identifiable, Hashable {
    let label: String
    let url: String

    var id: String { url }
}

struct TeamProfile: Identifiable {
    let name: String
    let matches: Int
    let fouls: Int
    let yellowCards: Int
    let redCards: Int
    let varReviews: Int

    var id: String { name }
    var foulsPerMatch: Double { matches == 0 ? 0 : Double(fouls) / Double(matches) }
    var read: String {
        if matches == 0 { return "No completed match sheet yet." }
        if foulsPerMatch >= 16 {
            return "\(name) have been busy in the referee's notebook: \(String(format: "%.1f", foulsPerMatch)) fouls per match."
        }
        return "\(name) have kept the temperature manageable so far."
    }
}
