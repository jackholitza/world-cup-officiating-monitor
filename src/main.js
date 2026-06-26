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
const initialMatch = fixtures.find((match) => new Date(match.datetime_mt).getTime() >= Date.now()) || fixtures.find((match) => {
  const date = new Date(match.datetime_mt);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}) || fixtures[0];
const state = {
  games: [],
  stats: disciplineSeed.results.map(normalizeStats),
  active: "today",
  selectedMatchId: initialMatch.match_id,
  selectedTeam: "Mexico",
  profileTeam: null,
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
  const finished = row.finished === true || String(row.finished).toLowerCase() === "true" || status === "finished" || status === "full_time";
  const started = finished || !["", "scheduled", "notstarted", "pre", "status_scheduled"].includes(status);
  return {
    match_id: match?.match_id || row.match_id || row.match_id_api || row.id,
    api_id: row.id || row.match_id_api,
    home: match?.home || home,
    away: match?.away || away,
    home_score: number(row.home_score ?? row.home_goals),
    away_score: number(row.away_score ?? row.away_goals),
    has_score: started && !["", null, undefined, "null"].includes(row.home_score ?? row.home_goals) && !["", null, undefined, "null"].includes(row.away_score ?? row.away_goals),
    finished,
    time_elapsed: finished ? "finished" : status || "scheduled",
    group: match?.group || row.group,
    local_date: row.local_date || match?.datetime_mt,
    home_scorers: parseScorers(row.home_scorers),
    away_scorers: parseScorers(row.away_scorers),
    referee: row.referee || "Assignment pending",
    referee_country: row.referee_country || "Country pending"
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
    referee_country: row.referee_country || refereeByName.get(row.referee)?.country || "Country pending",
    yellow_cards: number(row.yellow_cards),
    red_cards: number(row.red_cards),
    home_fouls: number(row.home_fouls),
    away_fouls: number(row.away_fouls),
    home_offsides: number(row.home_offsides),
    away_offsides: number(row.away_offsides),
    penalties: number(row.penalties),
    var_reviews: number(row.var_reviews),
    card_events: Array.isArray(row.card_events) ? row.card_events : [],
    foul_events: Array.isArray(row.foul_events) ? row.foul_events : [],
    var_events: Array.isArray(row.var_events) ? row.var_events : [],
    connector_links: Array.isArray(row.connector_links) ? row.connector_links : []
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
  const found = state.stats.find((row) => row.match_id === match.match_id);
  if (found) return found;
  const game = gameFor(match);
  return normalizeStats({
    match_id: match.match_id,
    home: match.home,
    away: match.away,
    referee: game?.referee,
    referee_country: game?.referee_country,
    source: "espn-public-schedule"
  });
}

function matchForStat(stat) {
  return fixtureById.get(stat.match_id) || findFixture(stat.home, stat.away, stat.match_id);
}

function isPlayedMatch(match) {
  const game = gameFor(match);
  if (game) return game.finished || game.has_score || !["scheduled", "notstarted", ""].includes(game.time_elapsed);
  return new Date(match.datetime_mt).getTime() <= Date.now();
}

function isPlayedStat(stat) {
  const match = matchForStat(stat);
  return match ? isPlayedMatch(match) : false;
}

function playedStats() {
  return state.stats.filter(isPlayedStat);
}

function statQuality(stats) {
  const source = String(stats.source || "").toLowerCase();
  const confidence = String(stats.confidence || "").toLowerCase();
  const played = isPlayedStat(stats);
  const modeled = source.includes("free-cache") || source.includes("seed") || confidence.includes("seed");
  const verified = source.includes("espn-public-verified") || confidence.includes("verified");
  if (!played) return { label: "Fixture watch", detail: "pre-match read, waiting for the final match sheet", tone: "projected" };
  if (verified) return { label: "Verified", detail: "ESPN public match stats connector", tone: "verified" };
  if (modeled || source.includes("schedule") || stats.referee === "Assignment pending") return { label: "Waiting on stats", detail: "the detailed ESPN match sheet has not landed yet", tone: "modeled" };
  return { label: "Source pending", detail: "the match needs a verified public match sheet", tone: "modeled" };
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

function allCardEvents(options = {}) {
  const rows = options.playedOnly === false ? state.stats : playedStats();
  return rows.flatMap((row) => (row.card_events || []).map((event) => ({ ...event, match: fixtureById.get(row.match_id), stats: row })));
}

function allFoulEvents(options = {}) {
  const rows = options.playedOnly === false ? state.stats : playedStats();
  return rows.flatMap((row) => (row.foul_events || []).map((event) => ({ ...event, match: fixtureById.get(row.match_id), stats: row })));
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
  const rows = playedStats();
  return teams.map((team) => {
    const cards = allCardEvents().filter((event) => event.team === team.country);
    const matchRows = rows.filter((stat) => stat.home === team.country || stat.away === team.country);
    const fouls = matchRows.reduce((sum, stat) => sum + (stat.home === team.country ? stat.home_fouls : stat.away_fouls), 0);
    return {
      team: team.country,
      yellows: cards.filter((event) => event.card !== "red").length,
      reds: cards.filter((event) => event.card === "red").length,
      fouls,
      matches: matchRows.length,
      foulsPerMatch: matchRows.length ? fouls / matchRows.length : 0,
      atRisk: playerDiscipline().filter((player) => player.team === team.country && player.atRisk).length
    };
  }).sort((a, b) => b.yellows + b.reds * 2 - (a.yellows + a.reds * 2) || b.fouls - a.fouls);
}

function refTable() {
  const rows = new Map();
  for (const stat of playedStats()) {
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
  const matches = playedStats().filter((stat) => stat.referee === referee);
  const totals = matches.reduce((sum, stat) => {
    sum.yellows += stat.yellow_cards;
    sum.reds += stat.red_cards;
    sum.fouls += stat.home_fouls + stat.away_fouls;
    sum.pens += stat.penalties;
    sum.varReviews += stat.var_reviews;
    const assessment = lopsidedAssessment(stat);
    sum.lopsided += assessment.level !== "normal" ? 1 : 0;
    sum.fair += assessment.level === "normal" && stat.red_cards === 0 ? 1 : 0;
    return sum;
  }, { yellows: 0, reds: 0, fouls: 0, pens: 0, varReviews: 0, lopsided: 0, fair: 0 });
  return {
    matches: matches.length,
    matchesList: matches,
    yellows: totals.yellows,
    reds: totals.reds,
    fouls: totals.fouls,
    pens: totals.pens,
    varReviews: totals.varReviews,
    lopsided: totals.lopsided,
    fair: totals.fair,
    cardsPerMatch: matches.length ? (totals.yellows + totals.reds) / matches.length : 0,
    foulsPerMatch: matches.length ? totals.fouls / matches.length : 0,
    pensPerMatch: matches.length ? totals.pens / matches.length : 0,
    varPerMatch: matches.length ? totals.varReviews / matches.length : 0
  };
}

function teamDirtyProfile(teamName) {
  const table = teamDiscipline();
  const row = table.find((team) => team.team === teamName) || { team: teamName, yellows: 0, reds: 0, fouls: 0, atRisk: 0 };
  const score = row.foulsPerMatch * 1.6 + row.yellows * 1.8 + row.reds * 5 + row.atRisk * 1.5;
  const ranked = table.map((team) => ({ ...team, score: team.foulsPerMatch * 1.6 + team.yellows * 1.8 + team.reds * 5 + team.atRisk * 1.5 })).sort((a, b) => b.score - a.score);
  const rank = Math.max(1, ranked.findIndex((team) => team.team === teamName) + 1);
  let label = "quiet";
  if (rank <= 8) label = "dirty";
  else if (rank <= 18 || row.foulsPerMatch >= 18 || row.yellows + row.reds >= 4) label = "chippy";
  return { ...row, score, rank, label };
}

function tournamentBaseline() {
  const rows = playedStats();
  const matches = Math.max(1, rows.length);
  const fouls = rows.reduce((sum, row) => sum + row.home_fouls + row.away_fouls, 0);
  const cards = rows.reduce((sum, row) => sum + row.yellow_cards + row.red_cards, 0);
  const vars = rows.reduce((sum, row) => sum + row.var_reviews, 0);
  return {
    teamFouls: fouls / (matches * 2) || 11.5,
    matchFouls: fouls / matches || 23,
    cards: cards / matches || 4.2,
    vars: vars / matches || 0.7
  };
}

function expectedMatch(match, stats = statsFor(match)) {
  const baseline = tournamentBaseline();
  const home = teamDirtyProfile(match.home);
  const away = teamDirtyProfile(match.away);
  const season = refSeason(stats.referee);
  const homeCards = home.matches ? (home.yellows + home.reds) / home.matches : baseline.cards / 2;
  const awayCards = away.matches ? (away.yellows + away.reds) / away.matches : baseline.cards / 2;
  const homeFoulRate = (home.fouls + baseline.teamFouls * 2) / (home.matches + 2);
  const awayFoulRate = (away.fouls + baseline.teamFouls * 2) / (away.matches + 2);
  const refFoulRate = season.matches ? season.foulsPerMatch : baseline.matchFouls;
  const refFactor = Math.max(.82, Math.min(1.18, refFoulRate / baseline.matchFouls));
  const homeFouls = homeFoulRate * refFactor;
  const awayFouls = awayFoulRate * refFactor;
  const refCards = season.matches ? season.cardsPerMatch : baseline.cards;
  const cards = refCards * .6 + (homeCards + awayCards) * .4;
  const vars = (season.matches ? season.varPerMatch : baseline.vars) * .7 + baseline.vars * .3;
  const homeHeat = homeFouls + homeCards * .8;
  const awayHeat = awayFouls + awayCards * .8;
  const dirtier = homeHeat >= awayHeat ? match.home : match.away;
  return {
    homeFouls,
    awayFouls,
    cards,
    vars,
    cardChance: poissonAtLeast(cards, 4),
    dirtier,
    refSample: season.matches,
    homeSample: home.matches,
    awaySample: away.matches
  };
}

function poissonAtLeast(lambda, threshold) {
  let term = Math.exp(-lambda);
  let cumulative = term;
  for (let k = 1; k < threshold; k += 1) {
    term *= lambda / k;
    cumulative += term;
  }
  return Math.max(0, Math.min(1, 1 - cumulative));
}

function projectionRead(match, projection, stats) {
  const assignment = stats.referee === "Assignment pending"
    ? "The referee assignment has not been published yet, so the card estimate uses the tournament average."
    : `${stats.referee}'s ${projection.refSample || "limited"}-match tournament record is included.`;
  return `${projection.dirtier} project as the busier side defensively. There is a ${Math.round(projection.cardChance * 100)}% chance of four or more cards. ${assignment}`;
}

function dirtiestPlayers(discipline = playerDiscipline()) {
  return discipline
    .map((player) => ({ ...player, heat: (player.red || 0) * 8 + player.yellow * 4 + (player.fouls || 0) }))
    .filter((player) => player.heat > 0)
    .sort((a, b) => b.heat - a.heat || b.yellow - a.yellow || (b.fouls || 0) - (a.fouls || 0));
}

function refMatchupRead(match, stats, season) {
  const home = teamDirtyProfile(match.home);
  const away = teamDirtyProfile(match.away);
  const dirtier = home.score >= away.score ? home : away;
  if (!season.matches) return `No played-match sample for this referee yet, so treat this as a watchlist rather than a settled profile. ${dirtier.team} are the team more likely to make the whistle feel busy once the match starts.`;
  const penLine = season.pensPerMatch >= 0.35 ? "This ref has pointed to the spot more often than most in the played sample" : "This ref has not been penalty-heavy in the played sample";
  const foulLine = season.foulsPerMatch >= 28 ? "and their games have tended to get scrappy." : "and their games have mostly stayed manageable.";
  return `${penLine} at ${cleanNumber(season.pensPerMatch, 2)} pens per match ${foulLine} ${dirtier.team} rate as the more combustible side (${dirtier.label}, rank ${dirtier.rank}), so judge any foul gap against how they usually play.`;
}

function refHistoryList(stats, season) {
  return season.matchesList
    .filter((matchStats) => matchStats.match_id !== stats.match_id)
    .slice(0, 4)
    .map((matchStats) => {
      const cards = matchStats.yellow_cards + matchStats.red_cards;
      return `<article class="mini-game"><b>${matchStats.home} vs ${matchStats.away}</b><span>${matchStats.home_fouls}-${matchStats.away_fouls} fouls</span><em>${matchStats.var_reviews} VAR · ${matchStats.penalties} pens · ${cards} cards</em></article>`;
    })
    .join("") || `<p class="empty-note">No earlier cached matches for this ref yet.</p>`;
}

function outcomePrompts(match, stats, season) {
  const home = teamDirtyProfile(match.home);
  const away = teamDirtyProfile(match.away);
  const dirtier = home.score >= away.score ? home : away;
  const quieter = home.score >= away.score ? away : home;
  const lop = lopsidedAssessment(stats);
  const leader = lop.leader === "Neither side" ? dirtier.team : lop.leader;
  return [
    `If ${dirtier.team} gets an early yellow, say: their normal discipline profile is already hot, so one more reckless foul could flip this from pressure to suspension risk.`,
    `If ${quieter.team} starts losing the foul count, say: that is more interesting than raw totals because they entered as the cleaner side in the cache.`,
    `If a penalty is given, say: ${stats.referee} is now tracking against a ${cleanNumber(season.pensPerMatch, 2)} pens-per-game baseline, so the next VAR review matters.`,
    `If the foul gap reaches ${lop.noise80 + 1} or more, say: ${leader} are getting the rougher side of the whistle and the referee is becoming part of the story.`,
    `If ${stats.referee} reaches ${Math.max(5, Math.ceil(season.cardsPerMatch + 2))} cards, say: the game is running above this ref's card baseline and second-yellow management becomes the story.`
  ];
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
  if (gap > noise95) return { home, away, total, gap, leader, noise80, noise95, level: "clear", label: "Heavy whistle tilt", confidence: "high" };
  if (gap > noise80) return { home, away, total, gap, leader, noise80, noise95, level: "lean", label: "Whistle leaning", confidence: "medium" };
  return { home, away, total, gap, leader, noise80, noise95, level: "normal", label: "Fairly even", confidence: "low" };
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
      <button class="refresh" data-refresh aria-label="Refresh match data" title="Refresh match data · updated ${state.updated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}">↻</button>
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
    ${state.profileTeam ? teamProfileModal(state.profileTeam, discipline) : ""}
  `;
  bind();
}

function runtimeLabel() {
  if (location.hostname === "jackholitza.github.io") return "GitHub Pages";
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return "Local preview";
  if (location.protocol === "file:") return "Local file";
  return location.hostname || "Static site";
}

function tab(id, label) {
  return `<button class="tab-${id} ${state.active === id ? "active" : ""}" data-tab="${id}">${label}</button>`;
}

function todayView(match, stats, game, discipline) {
  const queue = sortedMatches();
  const ref = refereeByName.get(stats.referee) || {};
  const season = refSeason(stats.referee);
  const cards = stats.card_events || [];
  const fouls = stats.foul_events || [];
  const varEvents = stats.var_events || [];
  const risks = discipline.filter((player) => [match.home, match.away].includes(player.team) && (player.atRisk || player.red)).slice(0, 8);
  const lop = lopsidedAssessment(stats);
  const quality = statQuality(stats);
  const played = isPlayedMatch(match);
  const projection = expectedMatch(match, stats);
  const dirtyPlayers = dirtiestPlayers(discipline).slice(0, 8);
  return `
    <main class="matchday">
      <section class="match-board">
        <div class="board-head">
          <div><h2>Matches</h2><span>${matchdayLabel()}</span></div>
          <label>Sort<select data-sort>
            <option value="today" ${state.sort === "today" ? "selected" : ""}>Today</option>
            <option value="live" ${state.sort === "live" ? "selected" : ""}>Live / Finished</option>
            <option value="upcoming" ${state.sort === "upcoming" ? "selected" : ""}>Upcoming</option>
            <option value="all" ${state.sort === "all" ? "selected" : ""}>All matches</option>
            <option value="cards" ${state.sort === "cards" ? "selected" : ""}>Most cards</option>
            <option value="fouls" ${state.sort === "fouls" ? "selected" : ""}>Most fouls</option>
          </select></label>
        </div>
        <div class="match-card-list">${queue.map(matchCard).join("")}</div>
      </section>
      <section class="hero-match">
        <div class="match-kicker">Group ${match.group} · ${match.venue} · ${matchStatus(match)}</div>
        <div class="quality-chip ${quality.tone}"><b>${quality.label}</b><span>${quality.detail}</span></div>
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
        ${played ? `
          <div class="stat-row">
            ${pill("Fouls", `${stats.home_fouls}-${stats.away_fouls}`)}
            ${pill("Cards", `${stats.yellow_cards}Y ${stats.red_cards}R`)}
            ${pill("Offside", `${stats.home_offsides}-${stats.away_offsides}`)}
            ${pill("VAR", `${stats.var_reviews}`)}
          </div>
          <div class="fan-read">${fanRead(match, stats)}</div>
          <div class="lopsided-card ${lop.level}">
            <div><span>Whistle balance</span><b>${lop.label}</b></div>
            <p>${lopsidedCopy(stats, lop, quality)}</p>
          </div>
        ` : projectionPanel(match, stats, projection)}
        ${sourcePanel(stats, quality)}
        <div class="ref-season">
          <h2>${stats.referee === "Assignment pending" ? "Referee outlook" : `${stats.referee}'s tournament`}</h2>
          <div class="stat-row">
            ${pill("Matches", season.matches)}
            ${pill("Pens/game", cleanNumber(season.pensPerMatch, 2))}
            ${pill("Fouls/game", cleanNumber(season.foulsPerMatch, 1))}
            ${pill("VAR/game", cleanNumber(season.varPerMatch, 2))}
          </div>
          <p>${refMatchupRead(match, stats, season)}</p>
          <div class="ref-games">
            <h3>Other games</h3>
            ${refHistoryList(stats, season)}
          </div>
        </div>
        <div class="prompt-board">
          <h2>Whiteboard reads</h2>
          <div class="prompt-list">${outcomePrompts(match, stats, season).map((prompt) => `<p>${prompt}</p>`).join("")}</div>
        </div>
        ${pitch(stats, played ? null : projection)}
      </section>
      <section class="side-panel dirty-board">
        <div class="panel-heading"><div><span>Tournament watch</span><h2>Dirtiest players so far</h2></div><b>${playedStats().length} matches</b></div>
        <p class="panel-intro">The players collecting the most cards and logged fouls in the verified match feed.</p>
        <div class="player-list dirty-list">${dirtyPlayers.map(dirtyPlayerItem).join("") || "<p>No player discipline events are available yet.</p>"}</div>
      </section>
      <section class="side-panel">
        <h2>Match feed</h2>
        <div class="event-list">${[...cards, ...fouls.slice(0, 8)].sort((a, b) => a.minute - b.minute).map(eventItem).join("") || "<p>No events in cache yet.</p>"}</div>
      </section>
      <section class="side-panel">
        <h2>VAR decisions</h2>
        <div class="event-list">${varEvents.map(varItem).join("") || "<p>No VAR decisions found in the verified commentary.</p>"}</div>
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
  return list.slice(0, state.sort === "today" ? 16 : state.sort === "all" ? fixtures.length : 28);
}

function fanRead(match, stats) {
  const lop = lopsidedAssessment(stats);
  const quality = statQuality(stats);
  if (quality.tone === "projected") return `This is a pre-match read, not a final stat sheet. The foul bar is there to show where the matchup could get touchy once the game starts.`;
  if (lop.level === "clear") return `${stats.referee} is calling this one heavily against ${lop.leader}. At ${stats.home_fouls}-${stats.away_fouls} fouls, that gap is big enough to feel like a real match story, not just normal chaos.`;
  if (lop.level === "lean") return `${stats.referee}'s whistle is starting to tilt toward ${lop.leader}. It is not a full-blown controversy yet, but the ${stats.home_fouls}-${stats.away_fouls} foul count is worth watching.`;
  if (stats.red_cards) return `This match already has a sending off, so the mood is different now. Every late tackle, protest, and crowded challenge is going to feel a little more dangerous.`;
  if (stats.yellow_cards >= 6) return `The referee has gone to the pocket a lot today: ${stats.yellow_cards} yellows so far. One clumsy challenge could turn someone's night from tense to finished.`;
  return `This still feels fairly even. The foul count is ${stats.home_fouls}-${stats.away_fouls}, close enough that the referee has not become the main character yet.`;
}

function lopsidedCopy(stats, lop, quality) {
  if (quality.tone === "projected") return `Pre-match foul read: ${stats.home_fouls}-${stats.away_fouls}. Use it as a matchup hint, then let the final whistle tell the truth.`;
  if (quality.tone === "modeled") return `The live score is in, but the full match sheet is still catching up. Treat the ${stats.home_fouls}-${stats.away_fouls} split as temporary.`;
  if (lop.level === "normal") return `The whistle has stayed pretty balanced: ${stats.home_fouls}-${stats.away_fouls} fouls from ${lop.total} total calls.`;
  return `${lop.leader} are taking more of the whistle: ${stats.home_fouls}-${stats.away_fouls} fouls, a gap of ${lop.gap} calls.`;
}

function sourcePanel(stats, quality) {
  const links = stats.connector_links || [];
  return `
    <div class="source-panel ${quality.tone}">
      <div><span>Match source</span><b>${quality.label}</b></div>
      <p>${quality.detail}. Fouls, cards, offsides, penalties, and VAR calls are only treated as final when this panel links to the public match source.</p>
      <div class="source-links">${links.map((link) => `<a href="${link.url}" target="_blank" rel="noreferrer">${link.label}</a>`).join("") || "<span>No verified connector attached yet.</span>"}</div>
    </div>
  `;
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
        <div class="table-list">${state.stats.filter((s) => lopsidedAssessment(s).level !== "normal").slice(0, 20).map(lopsidedItem).join("") || "<p>No match has a major whistle tilt right now.</p>"}</div>
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
  return `<span class="team" data-team="${name}" role="button" tabindex="0"><span>${t.flag || "•"}</span>${name}</span>`;
}

function pill(label, value) {
  return `<div class="pill"><span>${label}</span><b>${value}</b></div>`;
}

function projectionPanel(match, stats, projection) {
  return `
    <section class="projection-card">
      <div class="projection-head"><div><span>Pre-match forecast</span><h2>How physical could this get?</h2></div><b>Expected</b></div>
      <div class="stat-row projection-stats">
        ${pill("xFouls", `${cleanNumber(projection.homeFouls, 1)}-${cleanNumber(projection.awayFouls, 1)}`)}
        ${pill("xCards", cleanNumber(projection.cards, 1))}
        ${pill("xVAR", cleanNumber(projection.vars, 2))}
        ${pill("4+ cards", `${Math.round(projection.cardChance * 100)}%`)}
      </div>
      <div class="forecast-verdict"><span>Likely busier side</span><b>${projection.dirtier}</b></div>
      <p>${projectionRead(match, projection, stats)}</p>
      ${projectedTiltBar(match, projection)}
    </section>`;
}

function projectedTiltBar(match, projection) {
  const total = projection.homeFouls + projection.awayFouls;
  const homePct = Math.max(12, Math.min(88, projection.homeFouls / total * 100));
  return `
    <div class="tilt-meter projected" aria-label="Expected fouls: ${match.home} ${cleanNumber(projection.homeFouls, 1)}, ${match.away} ${cleanNumber(projection.awayFouls, 1)}">
      <div class="tilt-label"><span>${match.home}</span><b>expected foul share</b><span>${match.away}</span></div>
      <div class="tilt-track"><span class="tilt-home" style="width:${homePct}%"></span><span class="tilt-away" style="width:${100 - homePct}%"></span></div>
      <div class="tilt-count"><span>x${cleanNumber(projection.homeFouls, 1)}</span><span>x${cleanNumber(projection.awayFouls, 1)}</span></div>
    </div>`;
}

function pitch(stats, projection = null) {
  const homeFouls = projection?.homeFouls ?? stats.home_fouls;
  const awayFouls = projection?.awayFouls ?? stats.away_fouls;
  const total = Math.max(1, homeFouls + awayFouls);
  const home = Math.max(12, (homeFouls / total) * 78);
  const away = Math.max(12, (awayFouls / total) * 78);
  const prefix = projection ? "x" : "";
  return `<div class="pitch ${projection ? "projected" : ""}"><div class="half home" style="width:${home}%"><b>${prefix}${cleanNumber(homeFouls, projection ? 1 : 0)}</b><span>${projection ? "expected " : ""}home fouls</span></div><div class="half away" style="width:${away}%"><b>${prefix}${cleanNumber(awayFouls, projection ? 1 : 0)}</b><span>${projection ? "expected " : ""}away fouls</span></div></div>`;
}

function matchCard(match) {
  const game = gameFor(match);
  const stats = statsFor(match);
  const quality = statQuality(stats);
  const totalCards = stats.yellow_cards + stats.red_cards;
  const totalFouls = stats.home_fouls + stats.away_fouls;
  const played = isPlayedMatch(match);
  const projection = expectedMatch(match, stats);
  return `
    <button class="match-card ${match.match_id === state.selectedMatchId ? "active" : ""}" data-match="${match.match_id}">
      <div class="match-card-top"><span>${matchStatus(match)}</span><em>Group ${match.group}</em></div>
      <div class="match-card-score">
        ${team(match.home)}
        <strong>${compactScoreText(game)}</strong>
        ${team(match.away)}
      </div>
      <div class="match-card-ref"><b>${stats.referee}</b><span>${stats.referee_country}</span></div>
      <div class="quality-chip compact ${quality.tone}"><b>${quality.label}</b><span>${quality.tone === "projected" ? "before kickoff" : quality.tone === "modeled" ? "awaiting sheet" : "final sheet"}</span></div>
      <div class="match-card-stats ${played ? "" : "expected"}">
        <span>${played ? totalFouls : `xF ${cleanNumber(projection.homeFouls + projection.awayFouls, 1)}`}</span>
        <span>${played ? `${totalCards} cards` : `xC ${cleanNumber(projection.cards, 1)}`}</span>
        <span>${played ? `${stats.var_reviews} VAR` : `xVAR ${cleanNumber(projection.vars, 2)}`}</span>
      </div>
      ${played ? lopsidedBar(match, stats) : projectedTiltBar(match, projection)}
      ${played ? "" : `<div class="card-chance"><b>${Math.round(projection.cardChance * 100)}%</b><span>chance of 4+ cards</span><em>${projection.dirtier} likely busier</em></div>`}
    </button>
  `;
}

function eventItem(event) {
  const card = event.card ? `<b class="${event.card}">${event.card === "red" ? "RED" : "YELLOW"}</b>` : "<b>FOUL</b>";
  return `<article class="event"><span>${event.minute}'</span>${card}<div><strong>${event.player_name}</strong><em>${event.team} · ${event.reason || event.type}</em></div></article>`;
}

function varItem(event) {
  return `<article class="event var-event"><span>${event.minute}'</span><b>VAR</b><div><strong>${event.player_name || event.team || "Review"}</strong><em>${event.decision}</em></div></article>`;
}

function playerItem(player) {
  const meta = playerById.get(player.player_id) || {};
  return `<article class="row-card ${player.red ? "danger" : player.atRisk ? "warning" : ""}">${team(player.team)}<div><b>${player.player_name}</b><span>${meta.position || ""} ${meta.club ? `· ${meta.club}` : ""}</span></div><strong>${player.yellow}Y ${player.red}R</strong><em>${player.fouls || 0} fouls</em></article>`;
}

function dirtyPlayerItem(player, index) {
  const meta = playerById.get(player.player_id) || {};
  return `<article class="dirty-player"><strong>${index + 1}</strong><div><b>${player.player_name}</b><span>${player.team}${meta.position ? ` · ${meta.position}` : ""}</span></div><em>${player.yellow}Y ${player.red}R · ${player.fouls || 0} fouls</em></article>`;
}

function refItem(ref) {
  const tone = ref.lopsided > ref.fair ? "warning" : "good";
  return `<article class="row-card ${tone}"><div><b>${ref.name}</b><span>${ref.country}</span></div><strong>${ref.matches} matches</strong><em>${ref.yellows}Y ${ref.reds}R · ${ref.lopsided} with a strong foul tilt</em></article>`;
}

function lopsidedItem(stats) {
  const lop = lopsidedAssessment(stats);
  return `<button class="row-card warning" data-match="${stats.match_id}"><div><b>${stats.home} vs ${stats.away}</b><span>${stats.referee} · ${stats.referee_country}</span></div><strong>${stats.home_fouls}-${stats.away_fouls}</strong><em>${lop.label.toLowerCase()} · ${lop.gap} call gap</em></button>`;
}

function teamItem(row) {
  return `<button class="row-card" data-team="${row.team}"><div>${team(row.team)}</div><strong>${row.yellows}Y ${row.reds}R</strong><em>${row.matches} played · ${row.fouls} fouls · ${cleanNumber(row.foulsPerMatch, 1)}/match · ${row.atRisk} at risk</em></button>`;
}

function matchButton(match) {
  const game = gameFor(match);
  const stats = statsFor(match);
  const played = isPlayedMatch(match);
  const balance = played ? lopsidedBar(match, stats) : projectedTiltBar(match, expectedMatch(match, stats));
  return `<button class="match-button ${match.match_id === state.selectedMatchId ? "active" : ""}" data-match="${match.match_id}"><span>${matchStatus(match)}</span><b>${match.home} ${scoreText(game, "-")} ${match.away}</b><em>${stats.referee}</em>${balance}</button>`;
}

function lopsidedBar(match, stats) {
  const total = stats.home_fouls + stats.away_fouls;
  const lop = lopsidedAssessment(stats);
  const quality = statQuality(stats);
  const homePct = total ? Math.max(8, Math.min(92, (stats.home_fouls / total) * 100)) : 50;
  const awayPct = total ? Math.max(8, 100 - homePct) : 50;
  const label = quality.tone === "projected" ? "before kickoff" : quality.tone === "modeled" ? "awaiting sheet" : lop.level === "unknown" ? "No foul data yet" : lop.level === "normal" ? "fairly even" : `tilting toward ${lop.leader}`;
  return `
    <div class="tilt-meter ${lop.level} ${quality.tone}" aria-label="${match.home} ${stats.home_fouls} fouls, ${match.away} ${stats.away_fouls} fouls">
      <div class="tilt-label"><span>${match.home}</span><b>${label}</b><span>${match.away}</span></div>
      <div class="tilt-track"><span class="tilt-home" style="width:${homePct}%"></span><span class="tilt-away" style="width:${awayPct}%"></span></div>
      <div class="tilt-count"><span>${stats.home_fouls}</span><span>${stats.away_fouls}</span></div>
    </div>
  `;
}

function teamProfileModal(teamName, discipline) {
  const base = byTeam.get(teamName) || {};
  const row = teamDirtyProfile(teamName);
  const matches = playedStats().filter((stat) => stat.home === teamName || stat.away === teamName);
  const projections = state.stats.filter((stat) => (stat.home === teamName || stat.away === teamName) && !isPlayedStat(stat));
  const playerRows = discipline.filter((player) => player.team === teamName).slice(0, 6);
  const matchList = matches.slice(-5).reverse().map((stat) => {
    const opponent = stat.home === teamName ? stat.away : stat.home;
    const fouls = stat.home === teamName ? stat.home_fouls : stat.away_fouls;
    const against = stat.home === teamName ? stat.away_fouls : stat.home_fouls;
    return `<article class="mini-game"><b>${opponent}</b><span>${fouls}-${against} fouls</span><em>${stat.referee} · ${stat.yellow_cards}Y ${stat.red_cards}R · ${stat.var_reviews} VAR</em></article>`;
  }).join("") || `<p class="empty-note">No played match sample yet.</p>`;
  const projectionList = projections.slice(0, 3).map((stat) => {
    const opponent = stat.home === teamName ? stat.away : stat.home;
    const fouls = stat.home === teamName ? stat.home_fouls : stat.away_fouls;
    const against = stat.home === teamName ? stat.away_fouls : stat.home_fouls;
    return `<article class="mini-game projected"><b>${opponent}</b><span>${fouls}-${against} watch read</span><em>${stat.referee} · before kickoff</em></article>`;
  }).join("") || `<p class="empty-note">No future projections in the cache.</p>`;
  return `
    <div class="modal-backdrop" data-close-profile>
      <section class="team-modal" role="dialog" aria-label="${teamName} team profile">
        <button class="modal-close" data-close-profile aria-label="Close team profile">x</button>
        <div class="team-profile-head">
          <span>${base.flag || "•"}</span>
          <div><h2>${teamName}</h2><p>${teamProfileRead(row)}</p></div>
        </div>
        <div class="stat-row">
          ${pill("Fouls", row.fouls)}
          ${pill("Fouls/game", cleanNumber(row.foulsPerMatch, 1))}
          ${pill("Cards", `${row.yellows}Y ${row.reds}R`)}
          ${pill("Played", row.matches)}
        </div>
        <div class="profile-grid">
          <div class="ref-games"><h3>Recent match discipline</h3>${matchList}</div>
          <div class="ref-games"><h3>Players to watch</h3>${playerRows.map(playerItem).join("") || `<p class="empty-note">No player cards logged yet.</p>`}</div>
          <div class="ref-games"><h3>Upcoming estimates</h3>${projectionList}</div>
          <div class="ref-games"><h3>Data read</h3><p class="empty-note">${teamDataRead(row, projections.length)}</p></div>
        </div>
        <p class="profile-note">Played totals exclude future fixtures. Completed match sheets come from the verified public connector.</p>
      </section>
    </div>
  `;
}

function teamProfileRead(row) {
  if (!row.matches) return "No real match sample yet, so this profile will fill in as the tournament cache grows.";
  if (row.label === "dirty") return `${row.team} are near the top of the discipline table: rank ${row.rank}, ${cleanNumber(row.foulsPerMatch, 1)} fouls per match, and ${row.atRisk} players already on watch.`;
  if (row.label === "chippy") return `${row.team} are not out of control, but their played sample is busy: ${cleanNumber(row.foulsPerMatch, 1)} fouls per match, ${row.yellows} yellows, and rank ${row.rank} overall.`;
  return `${row.team} have mostly stayed out of the mess: ${cleanNumber(row.foulsPerMatch, 1)} fouls per match, with the card count still manageable.`;
}

function teamDataRead(row, projectionCount) {
  if (!row.matches) return `${row.team} has no played match sample in the worker yet. The visible bars are matchup estimates until the tournament feed catches up.`;
  return `${row.team}'s profile is built from ${row.matches} played match${row.matches === 1 ? "" : "es"} and keeps ${projectionCount} future estimate${projectionCount === 1 ? "" : "s"} separate. That is why this card may disagree with a raw all-fixtures sum.`;
}

function bind() {
  app.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { state.active = button.dataset.tab; render(); }));
  app.querySelectorAll("[data-team]").forEach((el) => el.addEventListener("click", (event) => { event.stopPropagation(); state.profileTeam = el.dataset.team; render(); }));
  app.querySelectorAll("[data-team]").forEach((el) => el.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); state.profileTeam = el.dataset.team; render(); } }));
  app.querySelectorAll("[data-close-profile]").forEach((el) => el.addEventListener("click", (event) => { if (event.target === el || el.classList.contains("modal-close")) { state.profileTeam = null; render(); } }));
  app.querySelectorAll("[data-match]").forEach((button) => button.addEventListener("click", (event) => { if (event.target.closest("[data-team]")) return; state.selectedMatchId = button.dataset.match; state.active = "today"; render(); }));
  app.querySelector("[data-sort]")?.addEventListener("change", (event) => { state.sort = event.target.value; render(); });
  app.querySelector("[data-refresh]")?.addEventListener("click", refresh);
}

render();
refresh();
