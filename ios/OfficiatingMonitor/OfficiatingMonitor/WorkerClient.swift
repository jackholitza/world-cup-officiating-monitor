import Combine
import Foundation

@MainActor
final class MonitorStore: ObservableObject {
    @Published var matches: [MatchStat] = []
    @Published var games: [LiveGame] = []
    @Published var meta: FeedMeta?
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var selectedTeam: TeamProfile?

    private let client = WorkerClient()

    func refresh() async {
        isLoading = true
        errorMessage = nil
        do {
            async let stats = client.matchStats()
            async let liveGames = client.games()
            let (statsEnvelope, gamesEnvelope) = try await (stats, liveGames)
            matches = statsEnvelope.results.sorted { ($0.localDate ?? "") < ($1.localDate ?? "") }
            games = gamesEnvelope.rows
            meta = statsEnvelope.meta
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func profile(for team: String) -> TeamProfile {
        let rows = matches.filter { $0.home == team || $0.away == team }
        let fouls = rows.reduce(0) { total, match in
            total + (match.home == team ? match.homeFouls : match.awayFouls)
        }
        let yellow = rows.reduce(0) { total, match in total + cards(for: team, in: match, color: "yellow") }
        let red = rows.reduce(0) { total, match in total + cards(for: team, in: match, color: "red") }
        let varReviews = rows.reduce(0) { total, match in
            total + match.varEvents.filter { $0.team == team }.count
        }
        return TeamProfile(name: team, matches: rows.count, fouls: fouls, yellowCards: yellow, redCards: red, varReviews: varReviews)
    }

    private func cards(for team: String, in match: MatchStat, color: String) -> Int {
        match.cardEvents.filter { $0.team == team && $0.card == color }.count
    }
}

struct WorkerClient {
    private let base = URL(string: "https://world-cup-officiating-monitor-api.jack-holitza.workers.dev")!

    func matchStats() async throws -> StatsEnvelope {
        try await get(path: "match-stats")
    }

    func games() async throws -> GamesEnvelope {
        try await get(path: "games")
    }

    private func get<T: Decodable>(path: String) async throws -> T {
        let url = base.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            throw URLError(.badServerResponse)
        }
        let decoder = JSONDecoder()
        return try decoder.decode(T.self, from: data)
    }
}
