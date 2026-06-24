import fixtures from "./data/fixtures.js";
import teams from "./data/teams.js";
import aliases from "./data/aliases.js";
import players from "./data/players.js";
import disciplineSeed from "./data/disciplineSeed.js";
import referees from "./data/referees.js";

const app = document.querySelector("#app");
const DISCIPLINE_API = "https://world-cup-officiating-monitor-api.jack-holitza.workers.dev";
const byTeam = new Map(teams.map((team) => [team.country, team]));
const fixtureById = new Map(fixtures.map((match) => [match.match_id, match]));
const playerById = new Map(players.map((player) => [player.player_id, player]));
const refereeByName = new Map(referees.map((ref) => [ref.name, ref]));
const state = {
  games: [],
  stats: disciplineSeed.results.map(normalizeStats),
  active: "today",
  selectedMatchId: "GA1",
  selectedTeam: "Mexico",
  sort: "today",
  status: "cache",
  updated: new Date()
};

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
    home_score: number(row.home_score ?? row.home_goals),
    away_score: number(row.away_score ?? row.away_goals),
    has_score: !["", null, undefined, "null"].includes(row.home_score ?? row.home_goals) && !["", null, undefined, "null"].includes(row.away_score ?? row.away_goals),
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
  if (value === null || value === undefined || value === "" || value === "null") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cleanNumber(value, digits = 0) {
  const n = number(value);
  return digits ? n.toFixed(digits) : String(Math.round(n));
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

function scoreText(game, fallback = "vs") {
  if (!game || !game.has_score) return fallback;
  return `${number(game.home_score)} - ${number(game.away_score)}`;
}

function compactScoreText(game, fallback = "vs") {
  if (!game || !game.has_score) return fallback;
  return `${number(game.home_score)}-${number(game.away_score)}`;
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
    const assessment = lopsidedAssessment(stat);
    if (assessment.level !== "normal") row.lopsided += 1;
    if (assessment.level === "normal" && stat.red_cards === 0) row.fair += 1;
    rows.set(stat.referee, row);
  }
  return [...rows.values()].sort((a, b) => b.matches - a.matches || b.yellows - a.yellows);
}

function refSeason(referee) {
  const matches = state.stats.filter((stat) => stat.referee === referee);
  const totals = matches.reduce((sum, stat) => {
    sum.yellows += stat.yellow_cards;
    sum.reds += stat.red_cards;
    sum.fouls += stat.home_fouls + stat.away_fouls;
    const assessment = lopsidedAssessment(stat);
    sum.lopsided += assessment.level !== "normal" ? 1 : 0;
    sum.fair += assessment.level === "normal" && stat.red_cards === 0 ? 1 : 0;
    return sum;
  }, { yellows: 0, reds: 0, fouls: 0, lopsided: 0, fair: 0 });
  return {
    matches: matches.length,
    yellows: totals.yellows,
    reds: totals.reds,
    fouls: totals.fouls,
    lopsided: totals.lopsided,
    fair: totals.fair,
    cardsPerMatch: matches.length ? (totals.yellows + totals.reds) / matches.length : 0,
    foulsPerMatch: matches.length ? totals.fouls / matches.length : 0
  };
}

function lopsidedAssessment(stats) {
  const home = number(stats.home_fouls);
  const away = number(stats.away_fouls);
  const total = home + away;
  const gap = Math.abs(home - away);
  const leader = home > away ? stats.home : away > home ? stats.away : "Neither side";
  if (!total) {
    return { home, away, total, gap, leader, noise80: 0, noise95: 0, level: "unknown", label: "No foul data", confidence: "unknown" };
  }
  const noise80 = Math.ceil(1.28 * Math.sqrt(total));
  const noise95 = Math.ceil(1.96 * Math.sqrt(total));
  if (gap > noise95) return { home, away, total, gap, leader, noise80, noise95, level: "clear", label: "Clearly lopsided", confidence: "high" };
  if (gap > noise80) return { home, away, total, gap, leader, noise80, noise95, level: "lean", label: "Leans lopsided", confidence: "medium" };
  return { home, away, total, gap, leader, noise80, noise95, level: "normal", label: "Within noise band", confidence: "low" };
}

function selectedMatch() {
  return fixtureById.get(state.selectedMatchId) || fixtures[0];
}

async function refresh() {
  try {
    const [gamesRes, statsRes] = await Promise.all([
      fetch(`${DISCIPLINE_API}/games`, { cache: "no-store" }),
      fetch(`${DISCIPLINE_API}/match-stats`, { cache: "no-store" })
    ]);
    const gamesPayload = gamesRes.ok ? await gamesRes.json() : null;
    const statsPayload = statsRes.ok ? await statsRes.json() : null;
    const nextGames = normalizeGamesFromPayload(gamesPayload);
    const nextStats = payloadArray(statsPayload).map(normalizeStats);
    if (nextGames.length) state.games = nextGames;
    if (nextStats.length) state.stats = nextStats;
    state.status = `${nextGames.length ? "Worker games" : "cache"} + ${nextStats.length ? "ref cache" : "local cache"}`;
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
  const queue = sortedMatches();
  const ref = refereeByName.get(stats.referee) || {};
  const season = refSeason(stats.referee);
  const cards = stats.card_events || [];
  const fouls = stats.foul_events || [];
  const risks = discipline.filter((player) => [match.home, match.away].includes(player.team) && (player.atRisk || player.red)).slice(0, 8);
  const lop = lopsidedAssessment(stats);
  return `
    <main class="matchday">
      <section class="match-board">
        <div class="board-head">
          <div><h2>Matches</h2><span>${matchdayLabel()}</span></div>
          <label>Sort<select data-sort>
            <option value="today" ${state.sort === "today" ? "selected" : ""}>Today</option>
            <option value="live" ${state.sort === "live" ? "selected" : ""}>Live / Finished</option>
            <option value="upcoming" ${state.sort === "upcoming" ? "selected" : ""}>Upcoming</option>
            <option value="cards" ${state.sort === "cards" ? "selected" : ""}>Most cards</option>
            <option value="fouls" ${state.sort === "fouls" ? "selected" : ""}>Most fouls</option>
          </select></label>
        </div>
        <div class="match-card-list">${queue.map(matchCard).join("")}</div>
      </section>
      <section class="hero-match">
        <div class="match-kicker">Group ${match.group} · ${match.venue} · ${matchStatus(match)}</div>
        <div class="scoreline">
          ${team(match.home)}
          <strong>${scoreText(game)}</strong>
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
        <div class="lopsided-card ${lop.level}">
          <div><span>Lopsidedness</span><b>${lop.label}</b></div>
          <p>${lop.leader} foul gap: ${lop.gap}. Expected noise band: ±${lop.noise80} medium, ±${lop.noise95} high confidence from ${lop.total} total fouls.</p>
        </div>
        <div class="ref-season">
          <h2>${stats.referee}'s tournament</h2>
          <div class="stat-row">
            ${pill("Matches", season.matches)}
            ${pill("Cards/match", cleanNumber(season.cardsPerMatch, 1))}
            ${pill("Fouls/match", cleanNumber(season.foulsPerMatch, 1))}
            ${pill("Lopsided", season.lopsided)}
          </div>
          <p>${season.fair >= season.lopsided ? "Mostly balanced whistle so far." : "Has already produced multiple lopsided foul profiles after accounting for the noise band."} ${season.yellows} yellows and ${season.reds} reds in cached tournament matches.</p>
        </div>
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
        <div class="player-list">${risks.map(playerItem).join("") || "<p>No players from this match are marked at risk in the current cache.</p>"}</div>
      </section>
    </main>
  `;
}

function matchdayLabel() {
  const now = new Date();
  return `Current date: ${now.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function sameLocalDay(match, date = new Date()) {
  const d = new Date(match.datetime_mt);
  return d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth() && d.getDate() === date.getDate();
}

function sortedMatches() {
  const now = Date.now();
  let list = fixtures.slice();
  if (state.sort === "today") {
    const today = list.filter((match) => sameLocalDay(match));
    list = today.length ? today : list.filter((match) => new Date(match.datetime_mt).getTime() >= now).slice(0, 8);
  }
  if (state.sort === "live") list = list.filter((match) => ["FT", "FT?"].includes(matchStatus(match)) || gameFor(match));
  if (state.sort === "upcoming") list = list.filter((match) => new Date(match.datetime_mt).getTime() >= now);
  list.sort((a, b) => {
    if (state.sort === "cards") return statsFor(b).yellow_cards + statsFor(b).red_cards * 2 - (statsFor(a).yellow_cards + statsFor(a).red_cards * 2);
    if (state.sort === "fouls") return statsFor(b).home_fouls + statsFor(b).away_fouls - (statsFor(a).home_fouls + statsFor(a).away_fouls);
    return new Date(a.datetime_mt) - new Date(b.datetime_mt);
  });
  return list.slice(0, state.sort === "today" ? 16 : 28);
}

function fanRead(match, stats) {
  const lop = lopsidedAssessment(stats);
  if (lop.level === "clear") return `${stats.referee}'s foul count is clearly lopsided: ${stats.home_fouls}-${stats.away_fouls}. ${lop.leader} are outside the ±${lop.noise95} high-confidence noise band.`;
  if (lop.level === "lean") return `${stats.referee}'s foul count leans lopsided: ${stats.home_fouls}-${stats.away_fouls}. ${lop.leader} are beyond the ±${lop.noise80} medium-confidence band, but not the ±${lop.noise95} high-confidence mark.`;
  if (stats.red_cards) return `This one has red-card danger. ${stats.red_cards} sending off is already in the cache, so the referee profile matters more than usual.`;
  if (stats.yellow_cards >= 6) return `Cards are the story: ${stats.yellow_cards} yellows logged. Watch second-yellow risk after halftime.`;
  return `Balanced within margin: ${stats.home_fouls}-${stats.away_fouls} fouls, gap ${lop.gap} inside the ±${lop.noise80} medium-confidence noise band.`;
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
        <div class="table-list">${state.stats.filter((s) => lopsidedAssessment(s).level !== "normal").slice(0, 20).map(lopsidedItem).join("") || "<p>No match is outside the current foul-noise band.</p>"}</div>
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
  const home = Math.max(12, (number(stats.home_fouls) / total) * 78);
  const away = Math.max(12, (number(stats.away_fouls) / total) * 78);
  return `<div class="pitch"><div class="half home" style="width:${home}%"><b>${stats.home_fouls}</b><span>home fouls</span></div><div class="half away" style="width:${away}%"><b>${stats.away_fouls}</b><span>away fouls</span></div></div>`;
}

function matchCard(match) {
  const game = gameFor(match);
  const stats = statsFor(match);
  const totalCards = stats.yellow_cards + stats.red_cards;
  const totalFouls = stats.home_fouls + stats.away_fouls;
  return `
    <button class="match-card ${match.match_id === state.selectedMatchId ? "active" : ""}" data-match="${match.match_id}">
      <div class="match-card-top"><span>${matchStatus(match)}</span><em>Group ${match.group}</em></div>
      <div class="match-card-score">
        ${team(match.home)}
        <strong>${compactScoreText(game)}</strong>
        ${team(match.away)}
      </div>
      <div class="match-card-ref"><b>${stats.referee}</b><span>${stats.referee_country}</span></div>
      <div class="match-card-stats">
        <span>${totalFouls} fouls</span>
        <span>${totalCards} cards</span>
        <span>${stats.var_reviews} VAR</span>
      </div>
    </button>
  `;
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
  return `<article class="row-card ${tone}"><div><b>${ref.name}</b><span>${ref.country}</span></div><strong>${ref.matches} matches</strong><em>${ref.yellows}Y ${ref.reds}R · ${ref.lopsided} outside band</em></article>`;
}

function lopsidedItem(stats) {
  const lop = lopsidedAssessment(stats);
  return `<button class="row-card warning" data-match="${stats.match_id}"><div><b>${stats.home} vs ${stats.away}</b><span>${stats.referee} · ${stats.referee_country}</span></div><strong>${stats.home_fouls}-${stats.away_fouls}</strong><em>gap ${lop.gap}, band ±${lop.noise80}/±${lop.noise95}</em></button>`;
}

function teamItem(row) {
  return `<article class="row-card"><div>${team(row.team)}</div><strong>${row.yellows}Y ${row.reds}R</strong><em>${row.fouls} fouls · ${row.atRisk} at risk</em></article>`;
}

function matchButton(match) {
  const game = gameFor(match);
  const stats = statsFor(match);
  return `<button class="match-button ${match.match_id === state.selectedMatchId ? "active" : ""}" data-match="${match.match_id}"><span>${matchStatus(match)}</span><b>${match.home} ${scoreText(game, "-")} ${match.away}</b><em>${stats.referee}</em></button>`;
}

function bind() {
  app.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { state.active = button.dataset.tab; render(); }));
  app.querySelectorAll("[data-match]").forEach((button) => button.addEventListener("click", () => { state.selectedMatchId = button.dataset.match; state.active = "today"; render(); }));
  app.querySelector("[data-sort]")?.addEventListener("change", (event) => { state.sort = event.target.value; render(); });
  app.querySelector("[data-refresh]")?.addEventListener("click", refresh);
}

render();
refresh();
