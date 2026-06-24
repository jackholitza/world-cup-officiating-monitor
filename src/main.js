import fixtures from "./data/fixtures.js";
import teams from "./data/teams.js";
import aliases from "./data/aliases.js";
import players from "./data/players.js";
import disciplineSeed from "./data/disciplineSeed.js";
import referees from "./data/referees.js";

const app = document.querySelector("#app");
const WCLIVE_API = "https://wc26liveapi.jack-holitza.workers.dev";
const DISCIPLINE_API = "https://world-cup-officiating-monitor-api.jack-holitza.workers.dev";
const state = {
  games: [],
  stats: disciplineSeed.results,
  active: "today",
  selectedMatchId: "GA1",
  selectedTeam: "Mexico",
  status: "cache",
  updated: new Date()
};

const byTeam = new Map(teams.map((team) => [team.country, team]));
const fixtureById = new Map(fixtures.map((match) => [match.match_id, match]));
const playerById = new Map(players.map((player) => [player.player_id, player]));
const refereeByName = new Map(referees.map((ref) => [ref.name, ref]));

function canonicalTeam(value) {
  const raw = String(value || "").trim();
  const manual = { Turkey: "Türkiye", Turkiye: "Türkiye", USA: "United States", "United States of America": "United States", Iran: "IR Iran", Curacao: "Curaçao", "Czech Republic": "Czechia", "Korea Republic": "South Korea" };
  if (byTeam.has(raw)) return raw;
  if (manual[raw]) return manual[raw];
  if (aliases[raw]) return aliases[raw];
  const loose = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  return teams.find((team) => team.country.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "") === loose)?.country || raw;
}

function payloadArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.response)) return data.response;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.games)) return data.games;
  return [];
}

function parseScorers(raw) {
  if (Array.isArray(raw)) return raw;
  const text = String(raw || "").trim();
  if (!text || text === "null") return [];
  return text.replace(/[{}"]/g, "").split(",").map((x) => x.trim()).filter(Boolean);
}

function normalizeGame(row) {
  const home = canonicalTeam(row.home_team_name_en || row.home || row.team_a);
  const away = canonicalTeam(row.away_team_name_en || row.away || row.team_b);
  const match = findFixture(home, away, row.match_id || row.match_id_api || row.id);
  const status = String(row.time_elapsed || row.status || "").toLowerCase();
  const finished = row.finished === true || String(row.finished).toLowerCase() === "true" || status === "finished";
  return {
    match_id: match?.match_id || row.match_id || row.match_id_api || row.id,
    api_id: row.id || row.match_id_api,
    home: match?.home || home,
    away: match?.away || away,
    home_score: Number(row.home_score ?? row.home_goals ?? 0),
    away_score: Number(row.away_score ?? row.away_goals ?? 0),
    finished,
    time_elapsed: finished ? "finished" : status || "scheduled",
    group: match?.group || row.group,
    local_date: row.local_date || match?.datetime_mt,
    home_scorers: parseScorers(row.home_scorers),
    away_scorers: parseScorers(row.away_scorers)
  };
}

function normalizeStats(row) {
  const home = canonicalTeam(row.home);
  const away = canonicalTeam(row.away);
  const match = findFixture(home, away, row.match_id);
  return {
    ...row,
    match_id: match?.match_id || row.match_id,
    home: match?.home || home,
    away: match?.away || away,
    referee: row.referee || "Assignment pending",
    referee_country: row.referee_country || refereeByName.get(row.referee)?.country || "TBD",
    yellow_cards: number(row.yellow_cards),
    red_cards: number(row.red_cards),
    home_fouls: number(row.home_fouls),
    away_fouls: number(row.away_fouls),
    home_offsides: number(row.home_offsides),
    away_offsides: number(row.away_offsides),
    penalties: number(row.penalties),
    var_reviews: number(row.var_reviews),
    card_events: Array.isArray(row.card_events) ? row.card_events : [],
    foul_events: Array.isArray(row.foul_events) ? row.foul_events : []
  };
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function findFixture(home, away, id) {
  if (id && fixtureById.has(id)) return fixtureById.get(id);
  return fixtures.find((match) => match.home === home && match.away === away)
    || fixtures.find((match) => match.home === away && match.away === home);
}

function gameFor(match) {
  return state.games.find((game) => game.match_id === match.match_id || (game.home === match.home && game.away === match.away));
}

function statsFor(match) {
  return state.stats.find((row) => row.match_id === match.match_id) || normalizeStats({ match_id: match.match_id, home: match.home, away: match.away });
}

function matchStatus(match) {
  const game = gameFor(match);
  if (game?.finished) return "FT";
  if (game && !["scheduled", "notstarted", ""].includes(game.time_elapsed)) return `${game.time_elapsed}'`;
  const start = new Date(match.datetime_mt).getTime();
  if (Date.now() > start + 150 * 60000) return "FT?";
  return new Date(match.datetime_mt).toLocaleDateString([], { month: "short", day: "numeric" });
}

function allCardEvents() {
  return state.stats.flatMap((row) => (row.card_events || []).map((event) => ({ ...event, match: fixtureById.get(row.match_id), stats: row })));
}

function allFoulEvents() {
  return state.stats.flatMap((row) => (row.foul_events || []).map((event) => ({ ...event, match: fixtureById.get(row.match_id), stats: row })));
}

function playerDiscipline() {
  const rows = new Map();
  for (const event of allCardEvents()) {
    const key = event.player_id || `${event.team}-${event.player_name}`;
    const row = rows.get(key) || { player_id: event.player_id, player_name: event.player_name, team: event.team, yellow: 0, red: 0, matches: new Set(), reasons: [] };
    if (event.card === "red") row.red += 1;
    else row.yellow += 1;
    row.matches.add(event.match_id);
    row.reasons.push(event.reason);
    rows.set(key, row);
  }
  for (const event of allFoulEvents()) {
    const key = event.player_id || `${event.team}-${event.player_name}`;
    const row = rows.get(key) || { player_id: event.player_id, player_name: event.player_name, team: event.team, yellow: 0, red: 0, matches: new Set(), reasons: [] };
    row.fouls = (row.fouls || 0) + 1;
    rows.set(key, row);
  }
  return [...rows.values()].map((row) => ({ ...row, matches: row.matches.size, atRisk: row.yellow >= 1 && !row.red })).sort((a, b) => b.red - a.red || b.yellow - a.yellow || (b.fouls || 0) - (a.fouls || 0));
}

function teamDiscipline() {
  return teams.map((team) => {
    const cards = allCardEvents().filter((event) => event.team === team.country);
    const fouls = allFoulEvents().filter((event) => event.team === team.country);
    return {
      team: team.country,
      yellows: cards.filter((event) => event.card !== "red").length,
      reds: cards.filter((event) => event.card === "red").length,
      fouls: fouls.length,
      atRisk: playerDiscipline().filter((player) => player.team === team.country && player.atRisk).length
    };
  }).sort((a, b) => b.yellows + b.reds * 2 - (a.yellows + a.reds * 2) || b.fouls - a.fouls);
}

function refTable() {
  const rows = new Map();
  for (const stat of state.stats) {
    const row = rows.get(stat.referee) || { name: stat.referee, country: stat.referee_country, matches: 0, yellows: 0, reds: 0, fouls: 0, lopsided: 0, fair: 0 };
    row.matches += 1;
    row.yellows += stat.yellow_cards;
    row.reds += stat.red_cards;
    row.fouls += stat.home_fouls + stat.away_fouls;
    const gap = Math.abs(stat.home_fouls - stat.away_fouls);
    if (gap >= 7) row.lopsided += 1;
    if (gap <= 3 && stat.red_cards === 0) row.fair += 1;
    rows.set(stat.referee, row);
  }
  return [...rows.values()].sort((a, b) => b.matches - a.matches || b.yellows - a.yellows);
}

function selectedMatch() {
  return fixtureById.get(state.selectedMatchId) || fixtures[0];
}

async function refresh() {
  try {
    const [gamesRes, statsRes] = await Promise.all([
      fetch(`${WCLIVE_API}/games`, { cache: "no-store" }),
      fetch(`${DISCIPLINE_API}/match-stats`, { cache: "no-store" })
    ]);
    const gamesPayload = gamesRes.ok ? await gamesRes.json() : null;
    const statsPayload = statsRes.ok ? await statsRes.json() : null;
    const nextGames = normalizeGamesFromPayload(gamesPayload);
    const nextStats = payloadArray(statsPayload).map(normalizeStats);
    if (nextGames.length) state.games = nextGames;
    if (nextStats.length) state.stats = nextStats;
    state.status = `${nextGames.length ? "WCLive" : "cache"} + ${nextStats.length ? "ref cache" : "local cache"}`;
  } catch {
    state.status = "offline cache";
  }
  state.updated = new Date();
  render();
}

function normalizeGamesFromPayload(payload) {
  return payloadArray(payload).map(normalizeGame).filter((game) => game.home && game.away);
}

function render() {
  const match = selectedMatch();
  const stats = statsFor(match);
  const game = gameFor(match);
  const discipline = playerDiscipline();
  app.innerHTML = `
    <header class="topbar">
      <div><span>World Cup discipline tracker</span><h1>Ref Watch</h1></div>
      <button class="refresh" data-refresh>↻</button>
      <div class="feed-status"><b>${state.status}</b><small>${state.updated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></div>
    </header>
    <nav class="tabs">
      ${tab("today", "Today")}
      ${tab("players", "Cards")}
      ${tab("refs", "Refs")}
      ${tab("teams", "Teams")}
    </nav>
    ${state.active === "today" ? todayView(match, stats, game, discipline) : ""}
    ${state.active === "players" ? playersView(discipline) : ""}
    ${state.active === "refs" ? refsView() : ""}
    ${state.active === "teams" ? teamsView() : ""}
  `;
  bind();
}

function tab(id, label) {
  return `<button class="${state.active === id ? "active" : ""}" data-tab="${id}">${label}</button>`;
}

function todayView(match, stats, game, discipline) {
  const queue = fixtures.filter((fixture) => ["FT", "FT?"].includes(matchStatus(fixture)) || new Date(fixture.datetime_mt) >= Date.now() - 86400000).slice(0, 14);
  const ref = refereeByName.get(stats.referee) || {};
  const cards = stats.card_events || [];
  const fouls = stats.foul_events || [];
  return `
    <main class="matchday">
      <section class="hero-match">
        <div class="match-kicker">Group ${match.group} · ${match.venue} · ${matchStatus(match)}</div>
        <div class="scoreline">
          ${team(match.home)}
          <strong>${game ? `${game.home_score} - ${game.away_score}` : "vs"}</strong>
          ${team(match.away)}
        </div>
        <div class="ref-card">
          <span>Center referee</span>
          <b>${stats.referee}</b>
          <em>${stats.referee_country} · ${stats.confederation || ref.confederation || "FIFA"}</em>
        </div>
        <div class="stat-row">
          ${pill("Fouls", `${stats.home_fouls}-${stats.away_fouls}`)}
          ${pill("Cards", `${stats.yellow_cards}Y ${stats.red_cards}R`)}
          ${pill("Offside", `${stats.home_offsides}-${stats.away_offsides}`)}
          ${pill("VAR", `${stats.var_reviews}`)}
        </div>
        <div class="fan-read">${fanRead(match, stats)}</div>
        ${pitch(stats)}
      </section>
      <section class="side-panel">
        <h2>Match feed</h2>
        <div class="event-list">${[...cards, ...fouls.slice(0, 8)].sort((a, b) => a.minute - b.minute).map(eventItem).join("") || "<p>No events in cache yet.</p>"}</div>
      </section>
      <section class="side-panel">
        <h2>Games</h2>
        <div class="match-list">${queue.map(matchButton).join("")}</div>
      </section>
      <section class="side-panel">
        <h2>Suspension watch</h2>
        <div class="player-list">${discipline.filter((p) => p.atRisk || p.red).slice(0, 8).map(playerItem).join("")}</div>
      </section>
    </main>
  `;
}

function fanRead(match, stats) {
  const gap = Math.abs(stats.home_fouls - stats.away_fouls);
  if (gap >= 8) return `${stats.referee} has a lopsided whistle profile here: ${stats.home_fouls}-${stats.away_fouls} fouls. ${stats.home_fouls > stats.away_fouls ? match.home : match.away} are taking the heavier contact load.`;
  if (stats.red_cards) return `This one has red-card danger. ${stats.red_cards} sending off is already in the cache, so the referee profile matters more than usual.`;
  if (stats.yellow_cards >= 6) return `Cards are the story: ${stats.yellow_cards} yellows logged. Watch second-yellow risk after halftime.`;
  return `Pretty balanced so far: ${stats.home_fouls}-${stats.away_fouls} fouls, ${stats.yellow_cards} yellows, and no major imbalance in the cached report.`;
}

function playersView(discipline) {
  return `
    <main class="wide-page">
      <section class="board">
        <h2>Players Near Trouble</h2>
        <div class="table-list">${discipline.slice(0, 36).map(playerItem).join("")}</div>
      </section>
      <section class="board">
        <h2>Red Cards</h2>
        <div class="table-list">${discipline.filter((p) => p.red).map(playerItem).join("") || "<p>No red cards in the current cache.</p>"}</div>
      </section>
    </main>
  `;
}

function refsView() {
  return `
    <main class="wide-page">
      <section class="board">
        <h2>Referee Form</h2>
        <div class="table-list">${refTable().map(refItem).join("")}</div>
      </section>
      <section class="board">
        <h2>Lopsided Whistles</h2>
        <div class="table-list">${state.stats.filter((s) => Math.abs(s.home_fouls - s.away_fouls) >= 7).slice(0, 20).map(lopsidedItem).join("")}</div>
      </section>
    </main>
  `;
}

function teamsView() {
  return `
    <main class="wide-page">
      <section class="board">
        <h2>Team Discipline Table</h2>
        <div class="table-list">${teamDiscipline().map(teamItem).join("")}</div>
      </section>
    </main>
  `;
}

function team(name) {
  const t = byTeam.get(name) || {};
  return `<span class="team"><span>${t.flag || "•"}</span>${name}</span>`;
}

function pill(label, value) {
  return `<div class="pill"><span>${label}</span><b>${value}</b></div>`;
}

function pitch(stats) {
  const total = Math.max(1, stats.home_fouls + stats.away_fouls);
  const home = Math.max(12, (stats.home_fouls / total) * 78);
  const away = Math.max(12, (stats.away_fouls / total) * 78);
  return `<div class="pitch"><div class="half home" style="width:${home}%"><b>${stats.home_fouls}</b><span>home fouls</span></div><div class="half away" style="width:${away}%"><b>${stats.away_fouls}</b><span>away fouls</span></div></div>`;
}

function eventItem(event) {
  const card = event.card ? `<b class="${event.card}">${event.card === "red" ? "RED" : "YELLOW"}</b>` : "<b>FOUL</b>";
  return `<article class="event"><span>${event.minute}'</span>${card}<div><strong>${event.player_name}</strong><em>${event.team} · ${event.reason || event.type}</em></div></article>`;
}

function playerItem(player) {
  const meta = playerById.get(player.player_id) || {};
  return `<article class="row-card ${player.red ? "danger" : player.atRisk ? "warning" : ""}">${team(player.team)}<div><b>${player.player_name}</b><span>${meta.position || ""} ${meta.club ? `· ${meta.club}` : ""}</span></div><strong>${player.yellow}Y ${player.red}R</strong><em>${player.fouls || 0} fouls</em></article>`;
}

function refItem(ref) {
  const tone = ref.lopsided > ref.fair ? "warning" : "good";
  return `<article class="row-card ${tone}"><div><b>${ref.name}</b><span>${ref.country}</span></div><strong>${ref.matches} matches</strong><em>${ref.yellows}Y ${ref.reds}R · ${ref.lopsided} lopsided</em></article>`;
}

function lopsidedItem(stats) {
  return `<button class="row-card warning" data-match="${stats.match_id}"><div><b>${stats.home} vs ${stats.away}</b><span>${stats.referee} · ${stats.referee_country}</span></div><strong>${stats.home_fouls}-${stats.away_fouls}</strong><em>fouls</em></button>`;
}

function teamItem(row) {
  return `<article class="row-card"><div>${team(row.team)}</div><strong>${row.yellows}Y ${row.reds}R</strong><em>${row.fouls} fouls · ${row.atRisk} at risk</em></article>`;
}

function matchButton(match) {
  const game = gameFor(match);
  const stats = statsFor(match);
  return `<button class="match-button ${match.match_id === state.selectedMatchId ? "active" : ""}" data-match="${match.match_id}"><span>${matchStatus(match)}</span><b>${match.home} ${game ? game.home_score : ""} - ${game ? game.away_score : ""} ${match.away}</b><em>${stats.referee}</em></button>`;
}

function bind() {
  app.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { state.active = button.dataset.tab; render(); }));
  app.querySelectorAll("[data-match]").forEach((button) => button.addEventListener("click", () => { state.selectedMatchId = button.dataset.match; state.active = "today"; render(); }));
  app.querySelector("[data-refresh]")?.addEventListener("click", refresh);
}

render();
refresh();
