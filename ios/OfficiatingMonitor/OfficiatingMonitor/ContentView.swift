import SwiftUI

struct ContentView: View {
    @StateObject private var store = MonitorStore()
    @State private var selectedMatch: MatchStat?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HeaderCard(meta: store.meta, loading: store.isLoading)
                }
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)

                Section("Verified match sheets") {
                    ForEach(store.matches) { match in
                        Button {
                            selectedMatch = match
                        } label: {
                            MatchRow(match: match)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .listStyle(.plain)
            .background(WhiteboardBackground())
            .navigationTitle("Ref Watch")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await store.refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(store.isLoading)
                }
            }
            .task {
                if store.matches.isEmpty {
                    await store.refresh()
                    selectedMatch = store.matches.first
                }
            }
            .sheet(item: $selectedMatch) { match in
                MatchDetailView(match: match, store: store)
            }
            .sheet(item: $store.selectedTeam) { profile in
                TeamProfileView(profile: profile)
            }
            .overlay {
                if let message = store.errorMessage {
                    Text(message)
                        .font(.footnote.weight(.semibold))
                        .padding()
                        .background(.red.opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
                        .padding()
                }
            }
        }
    }
}

struct HeaderCard: View {
    let meta: FeedMeta?
    let loading: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("World Cup officiating monitor")
                .font(.caption.weight(.black))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
            Text("Verified football reads, not guesswork.")
                .font(.title2.weight(.black))
            HStack {
                Label("\(meta?.rows ?? 0) match sheets", systemImage: "checkmark.seal.fill")
                Spacer()
                Text(loading ? "Updating..." : "ESPN public stats")
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
        }
        .padding()
        .background(.white, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(.black, lineWidth: 2))
    }
}

struct MatchRow: View {
    let match: MatchStat

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(match.group.map { "Group \($0)" } ?? "World Cup")
                    .font(.caption.weight(.black))
                    .foregroundStyle(.secondary)
                Spacer()
                Text(match.statusLabel)
                    .font(.caption.weight(.black))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.green.opacity(0.18), in: Capsule())
            }

            HStack(alignment: .center) {
                Text(match.home)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text("vs")
                    .font(.headline.weight(.black))
                Text(match.away)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .font(.headline.weight(.heavy))

            TiltBar(match: match)

            HStack {
                stat("Fouls", "\(match.homeFouls)-\(match.awayFouls)")
                stat("Cards", "\(match.yellowCards)Y \(match.redCards)R")
                stat("VAR", "\(match.varReviews)")
            }
        }
        .padding()
        .background(.white, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(.black, lineWidth: 2))
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2.weight(.black)).foregroundStyle(.secondary)
            Text(value).font(.callout.weight(.heavy))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct TiltBar: View {
    let match: MatchStat

    var body: some View {
        let total = max(match.totalFouls, 1)
        let homeWidth = max(0.08, Double(match.homeFouls) / Double(total))
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(match.home)
                Spacer()
                Text(match.foulLeader == "Even" ? "fairly even" : "whistle tilts \(match.foulLeader)")
                    .fontWeight(.black)
                Spacer()
                Text(match.away)
            }
            .font(.caption2)
            GeometryReader { proxy in
                HStack(spacing: 0) {
                    Rectangle()
                        .fill(Color.red.opacity(0.58))
                        .frame(width: proxy.size.width * homeWidth)
                    Rectangle()
                        .fill(Color.blue.opacity(0.48))
                }
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(.black, lineWidth: 2))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .frame(height: 14)
        }
    }
}

struct MatchDetailView: View {
    let match: MatchStat
    @ObservedObject var store: MonitorStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    MatchRow(match: match)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Referee")
                            .font(.headline.weight(.black))
                        Text(match.referee)
                            .font(.title3.weight(.heavy))
                        Text(match.refereeCountry ?? "FIFA crew")
                            .foregroundStyle(.secondary)
                    }
                    .cardStyle()

                    SourceLinksView(match: match)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Teams")
                            .font(.headline.weight(.black))
                        HStack {
                            teamButton(match.home)
                            teamButton(match.away)
                        }
                    }
                    .cardStyle()

                    EventSection(title: "Cards", rows: match.cardEvents.map { "\($0.minute)' \($0.playerName), \($0.team): \($0.card.uppercased())" })
                    EventSection(title: "VAR decisions", rows: match.varEvents.map { "\($0.minute)' \($0.decision)" })
                    EventSection(title: "Fouls from commentary", rows: Array(match.foulEvents.prefix(10)).map { "\($0.minute)' \($0.playerName), \($0.team)" })
                }
                .padding()
            }
            .background(WhiteboardBackground())
            .navigationTitle("\(match.home) vs \(match.away)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func teamButton(_ name: String) -> some View {
        Button {
            store.selectedTeam = store.profile(for: name)
        } label: {
            Text(name)
                .font(.headline.weight(.black))
                .frame(maxWidth: .infinity)
                .padding()
                .background(.yellow.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(.black, lineWidth: 2))
        }
        .buttonStyle(.plain)
    }
}

struct SourceLinksView: View {
    let match: MatchStat

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Verified match source", systemImage: "checkmark.seal.fill")
                .font(.headline.weight(.black))
            Text("Fouls, cards, offsides, penalties, and VAR decisions come from the public match sheet linked below.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            ForEach(match.connectorLinks) { link in
                if let url = URL(string: link.url) {
                    Link(link.label, destination: url)
                        .font(.callout.weight(.heavy))
                }
            }
        }
        .cardStyle()
    }
}

struct EventSection: View {
    let title: String
    let rows: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline.weight(.black))
            if rows.isEmpty {
                Text("Nothing listed on the final sheet.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(rows, id: \.self) { row in
                    Text(row)
                        .font(.callout)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(.white.opacity(0.65), in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
        .cardStyle()
    }
}

struct TeamProfileView: View {
    let profile: TeamProfile
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Text(profile.name)
                    .font(.largeTitle.weight(.black))
                Text(profile.read)
                    .font(.headline)
                HStack {
                    stat("Played", "\(profile.matches)")
                    stat("Fouls", "\(profile.fouls)")
                }
                HStack {
                    stat("Fouls/match", String(format: "%.1f", profile.foulsPerMatch))
                    stat("Cards", "\(profile.yellowCards)Y \(profile.redCards)R")
                }
                stat("VAR involved", "\(profile.varReviews)")
                Spacer()
            }
            .padding()
            .background(WhiteboardBackground())
            .navigationTitle("Team profile")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption.weight(.black)).foregroundStyle(.secondary)
            Text(value).font(.title2.weight(.heavy))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.white, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(.black, lineWidth: 2))
    }
}

struct WhiteboardBackground: View {
    var body: some View {
        Color(red: 0.985, green: 0.975, blue: 0.93)
            .ignoresSafeArea()
    }
}

extension View {
    func cardStyle() -> some View {
        padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(.black, lineWidth: 2))
    }
}
