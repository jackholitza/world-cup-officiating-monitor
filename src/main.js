import fixtures from "./data/fixtures.js";
import teams from "./data/teams.js";
import strengths from "./data/teamStrengths.js";
import aliases from "./data/aliases.js";
import liveSeed from "./data/liveSeed.js";
import historical from "./data/officiatingHistorical.js";

const app = document.querySelector("#app");
const API_BASE = location.hostname.includes("localhost") || location.hostname.includes("127.0.0.1") ? "/api" : "https://wc26-officiating-api.example.workers.dev";
const state = {
  liveResults: normalizePayload(liveSeed),
  matchStats: [],
  apiStatus: "cache seed",
  lastRefresh: new Date(),
  activeView: "dashboard",
  focusMatchId: fixtures[0]?.match_id,
  focusTeam: "United States",
  includeLiveInTable: true
};

const byTeam = new Map(teams.map((team) => [team.country, team]));
const strengthByTeam = new Map(strengths.map((team) => [team.country, team]));
const fixtureById = new Map(fixtures.map((match) => [match.match_id, match]));
const groups = [...new Set(teams.map((team) => team.group))].sort((a, b) => a.localeCompare(b));

function canonicalTeam(value) {
  const raw = String(value || "").trim();
  if (byTeam.has(raw)) return raw;
  const manual = {
    USA: "United States",
    "United States of America": "United States",
    Iran: "IR Iran",
    Turkiye: "Türkiye",
    Turkey: "Türkiye",
    "Cape Verde": "Cabo Verde",
    Curacao: "Curaçao",
    "Czech Republic": "Czechia",
    "Korea Republic": "South Korea",
    "Bosnia": "Bosnia and Herzegovina",
    "Bosnia & Herzegovina": "Bosnia and Herzegovina"
  };
  if (manual[raw]) return manual[raw];
  if (aliases[raw]) return aliases[raw];
  const loose = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  return teams.find((team) => team.country.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "") === loose)?.country || raw;
}

function pct(value, digits = 0) {
  return `${((Number(value) || 0) * 100).toFixed(digits)}%`;
}

function fmtNumber(value, digits = 1) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "unknown";
}

function payloadArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.games)) return data.games;
  if (Array.isArray(data?.data?.games)) return data.data.games;
  if (Array.isArray(data?.response)) return data.response;
  return [];
}

function normalizePayload(data) {
  return payloadArray(data).map(normalizeGame).filter(Boolean);
}

function normalizeGame(row) {
  const home = canonicalTeam(row.home_team_name_en || row.home || row.homeTeam || row.team_a);
  const away = canonicalTeam(row.away_team_name_en || row.away || row.awayTeam || row.team_b);
  const matched = matchFixture({ home, away, id: row.match_id || row.match_id_api || row.id });
  if (!matched && (!home || !away)) return null;
  const status = String(row.time_elapsed || row.status || row.state || "").toLowerCase();
  const finished = row.finished === true || ["finished", "ft", "fulltime", "post"].includes(status);
  return {
    match_id: matched?.match_id || row.match_id || row.match_id_api || row.id,
    home: matched?.home || home,
    away: matched?.away || away,
    home_score: Number(row.home_score ?? row.home_goals ?? row.homeScore ?? 0),
    away_score: Number(row.away_score ?? row.away_goals ?? row.awayScore ?? 0),
    finished,
    time_elapsed: finished ? "finished" : status || "scheduled",
    group: matched?.group || row.group,
    source: row.source || "reddit-worker",
    raw: row
  };
}

function normalizeStatsPayload(data) {
  return payloadArray(data).map((row) => {
    const home = canonicalTeam(row.home || row.home_team_name_en || row.team_a);
    const away = canonicalTeam(row.away || row.away_team_name_en || row.team_b);
    const matched = matchFixture({ home, away, id: row.match_id || row.id });
    return {
      match_id: matched?.match_id || row.match_id || row.id,
      referee: row.referee || row.official || row.center_referee || "Unknown",
      yellow_cards: Number(row.yellow_cards ?? row.cards?.yellow ?? row.total_yellows ?? NaN),
      red_cards: Number(row.red_cards ?? row.cards?.red ?? row.total_reds ?? NaN),
      home_fouls: Number(row.home_fouls ?? row.fouls?.home ?? NaN),
      away_fouls: Number(row.away_fouls ?? row.fouls?.away ?? NaN),
      home_offsides: Number(row.home_offsides ?? row.offsides?.home ?? NaN),
      away_offsides: Number(row.away_offsides ?? row.offsides?.away ?? NaN),
      penalties: Number(row.penalties ?? row.penalty_awards ?? NaN),
      var_reviews: Number(row.var_reviews ?? row.var ?? NaN),
      confidence: row.confidence || row.source_confidence || "observed",
      source: row.source || "reddit-worker"
    };
  });
}

function matchFixture({ home, away, id }) {
  if (id && fixtureById.has(id)) return fixtureById.get(id);
  return fixtures.find((match) => match.home === home && match.away === away)
    || fixtures.find((match) => match.home === away && match.away === home);
}

function overlayFor(match) {
  return state.liveResults.find((result) => result.match_id === match.match_id || (result.home === match.home && result.away === match.away));
}

function statsFor(match) {
  return state.matchStats.find((row) => row.match_id === match.match_id) || estimateStats(match);
}

function estimateStats(match) {
  const homeRisk = teamRisk(match.home);
  const awayRisk = teamRisk(match.away);
  const favoriteGap = Math.abs((match.pre_match_probabilities?.home_win || 0) - (match.pre_match_probabilities?.away_win || 0));
  return {
    match_id: match.match_id,
    referee: "Unknown",
    yellow_cards: Math.round(2.2 + (homeRisk.card_risk + awayRisk.card_risk) * 2.1 + (1 - favoriteGap) * 1.2),
    red_cards: homeRisk.card_risk + awayRisk.card_risk > 1.35 ? 1 : 0,
    home_fouls: Math.round(8 + homeRisk.foul_pressure * 10),
    away_fouls: Math.round(8 + awayRisk.foul_pressure * 10),
    home_offsides: Math.round(1 + attackRisk(match.home) * 2),
    away_offsides: Math.round(1 + attackRisk(match.away) * 2),
    penalties: matchIsKnockout(match) ? 1 : favoriteGap < 0.12 ? 1 : 0,
    var_reviews: matchIsKnockout(match) ? 2 : 1,
    confidence: "estimated",
    source: "historical-cache"
  };
}

function teamRisk(teamName) {
  const compact = teamName.replace(/\s+/g, "");
  const prior = historical.teamDisciplinePriors[teamName] || historical.teamDisciplinePriors[compact];
  if (prior) return prior;
  const rating = strengthByTeam.get(teamName) || byTeam.get(teamName) || {};
  const defensiveStress = Math.max(0, 70 - (rating.defense_rating || 55)) / 70;
  const press = Math.max(0, (rating.attack_rating || 55) - (rating.midfield_rating || 55)) / 70;
  return {
    card_risk: Math.min(0.82, 0.34 + defensiveStress * 0.38 + press * 0.12),
    foul_pressure: Math.min(0.86, 0.36 + defensiveStress * 0.42),
    dissent_risk: 0.35,
    note: "Model-inferred from team strength profile; no curated discipline prior."
  };
}

function attackRisk(teamName) {
  const team = strengthByTeam.get(teamName) || byTeam.get(teamName) || {};
  return Math.max(0, Math.min(1, ((team.attack_rating || 55) - 45) / 45));
}

function matchIsKnockout(match) {
  return match.stage && match.stage !== "Group";
}

function matchState(match) {
  const overlay = overlayFor(match);
  if (overlay?.finished) return "finished";
  if (overlay && !["scheduled", "notstarted", ""].includes(String(overlay.time_elapsed || "").toLowerCase())) return "live";
  const start = new Date(match.datetime_mt).getTime();
  if (Date.now() >= start && Date.now() < start + 130 * 60000) return "live";
  if (Date.now() > start + 150 * 60000) return "finished-empty";
  return "upcoming";
}

function computeTables() {
  const tables = Object.fromEntries(groups.map((group) => [group, teams.filter((team) => team.group === group).map((team) => ({
    team: team.country, group, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, fairPlay: 0, live: false
  }))]));
  const usable = state.liveResults.filter((result) => result.finished || (state.includeLiveInTable && !["scheduled", "notstarted"].includes(String(result.time_elapsed || ""))));
  usable.forEach((result) => {
    const match = matchFixture(result);
    if (!match) return;
    const rows = tables[match.group];
    const home = rows?.find((row) => row.team === match.home);
    const away = rows?.find((row) => row.team === match.away);
    if (!home || !away) return;
    applyResult(home, away, result.home_score, result.away_score, !result.finished);
    const stats = statsFor(match);
    const halfCards = Number.isFinite(stats.yellow_cards) ? stats.yellow_cards / 2 : 0;
    home.fairPlay -= halfCards + (Number.isFinite(stats.red_cards) ? stats.red_cards * 1.5 : 0);
    away.fairPlay -= halfCards + (Number.isFinite(stats.red_cards) ? stats.red_cards * 1.5 : 0);
  });
  Object.values(tables).forEach((rows) => rows.sort(compareTableRows));
  return tables;
}

function applyResult(home, away, homeScore, awayScore, live = false) {
  home.p += 1; away.p += 1;
  home.gf += homeScore; home.ga += awayScore;
  away.gf += awayScore; away.ga += homeScore;
  home.gd = home.gf - home.ga; away.gd = away.gf - away.ga;
  home.live ||= live; away.live ||= live;
  if (homeScore > awayScore) { home.w += 1; away.l += 1; home.pts += 3; }
  else if (awayScore > homeScore) { away.w += 1; home.l += 1; away.pts += 3; }
  else { home.d += 1; away.d += 1; home.pts += 1; away.pts += 1; }
}

function compareTableRows(a, b) {
  return b.pts - a.pts
    || b.gd - a.gd
    || b.gf - a.gf
    || b.fairPlay - a.fairPlay
    || modelRating(b.team) - modelRating(a.team)
    || a.team.localeCompare(b.team);
}

function modelRating(teamName) {
  return strengthByTeam.get(teamName)?.model_rating || byTeam.get(teamName)?.model_rating || 50;
}

function projectedQualifiers(tables) {
  const winners = [];
  const runners = [];
  const thirds = [];
  Object.entries(tables).forEach(([group, rows]) => {
    if (rows[0]) winners.push(seedEntry(rows[0], "winner", group));
    if (rows[1]) runners.push(seedEntry(rows[1], "runner-up", group));
    if (rows[2]) thirds.push(seedEntry(rows[2], "third-place", group));
  });
  thirds.sort(compareSeedRows);
  return [...winners, ...runners, ...thirds.slice(0, 8)].sort(compareSeedRows).slice(0, 32).map((entry, index) => ({ ...entry, seed: index + 1 }));
}

function seedEntry(row, slot, group) {
  return {
    ...row,
    slot,
    group,
    seedScore: row.pts * 100 + row.gd * 12 + row.gf * 4 + row.fairPlay + modelRating(row.team) / 4
  };
}

function compareSeedRows(a, b) {
  return b.seedScore - a.seedScore || compareTableRows(a, b);
}

function buildBracket(tables) {
  const seeds = projectedQualifiers(tables);
  const r32 = [];
  for (let i = 0; i < 16; i += 1) {
    const high = seeds[i];
    const low = seeds[31 - i];
    if (high && low) r32.push({ id: `R32-${i + 1}`, teams: [high, low], winner: projectWinner(high, low) });
  }
  return { seeds, rounds: advanceRounds(r32) };
}

function projectWinner(a, b) {
  if (!a) return b;
  if (!b) return a;
  const disciplineDragA = teamRisk(a.team).card_risk * 3;
  const disciplineDragB = teamRisk(b.team).card_risk * 3;
  return modelRating(a.team) - disciplineDragA >= modelRating(b.team) - disciplineDragB ? a : b;
}

function advanceRounds(r32) {
  const rounds = [["Round of 32", r32]];
  let current = r32;
  ["Round of 16", "Quarterfinal", "Semifinal", "Final"].forEach((label) => {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      const teamsInMatch = [current[i]?.winner, current[i + 1]?.winner].filter(Boolean);
      if (teamsInMatch.length) next.push({ id: `${label}-${next.length + 1}`, teams: teamsInMatch, winner: projectWinner(teamsInMatch[0], teamsInMatch[1]) });
    }
    rounds.push([label, next]);
    current = next;
  });
  const champion = current[0]?.winner ? [{ id: "Champion", teams: [current[0].winner], winner: current[0].winner }] : [];
  rounds.push(["Champion", champion]);
  return rounds;
}

function refereeProfile(name) {
  return historical.refereeProfiles.find((ref) => ref.name.toLowerCase() === String(name || "").toLowerCase())
    || historical.refereeProfiles.find((ref) => ref.name === "Unknown");
}

function signalFor(match) {
  const stats = statsFor(match);
  const ref = refereeProfile(stats.referee);
  const homeRisk = teamRisk(match.home);
  const awayRisk = teamRisk(match.away);
  const foulTotal = (Number.isFinite(stats.home_fouls) ? stats.home_fouls : 0) + (Number.isFinite(stats.away_fouls) ? stats.away_fouls : 0);
  const foulAsymmetry = Math.abs((stats.home_fouls || 0) - (stats.away_fouls || 0)) / Math.max(1, foulTotal);
  const strictness = Number.isFinite(ref.cards_per_match) ? Math.min(1, ref.cards_per_match / 7) : 0.5;
  const cardPressure = (homeRisk.card_risk + awayRisk.card_risk) / 2;
  const varRisk = Math.min(1, ((stats.var_reviews || 1) + (stats.penalties || 0) * 1.4) / 5);
  const stakes = matchStakes(match);
  const confidenceDrag = stats.confidence === "unknown" ? 0.6 : stats.confidence === "estimated" ? 0.35 : 0.08;
  const w = historical.signalWeights;
  const risk = strictness * w.referee_strictness
    + cardPressure * w.team_card_pressure
    + foulAsymmetry * w.foul_asymmetry
    + varRisk * w.var_penalty_environment
    + stakes * w.match_stakes
    + confidenceDrag * w.data_confidence_drag;
  const label = stats.confidence === "unknown" ? "unknown" : risk >= 0.68 ? "poor" : risk >= 0.46 ? "watch" : "good";
  return {
    risk,
    label,
    stats,
    ref,
    reasons: [
      `${fmtNumber(ref.cards_per_match)} referee cards/match profile`,
      `${fmtNumber(cardPressure)} team card pressure`,
      `${fmtNumber(foulAsymmetry)} foul asymmetry`,
      `${stats.confidence} source confidence`
    ]
  };
}

function matchStakes(match) {
  const n = Number(match.match_id?.match(/\d+/)?.[0] || 1);
  return Math.min(1, n / 6);
}

async function refreshLive() {
  try {
    const [gamesRes, statsRes] = await Promise.all([
      fetch(`${API_BASE}/games`, { cache: "no-store" }),
      fetch(`${API_BASE}/match-stats`, { cache: "no-store" }).catch(() => null)
    ]);
    if (!gamesRes.ok) throw new Error("games feed unavailable");
    const gamesPayload = await gamesRes.json();
    const nextGames = normalizePayload(gamesPayload);
    if (nextGames.length) {
      state.liveResults = nextGames;
      localStorage.setItem("wcom_games", JSON.stringify(nextGames));
    }
    if (statsRes?.ok) {
      const statsPayload = await statsRes.json();
      const nextStats = normalizeStatsPayload(statsPayload);
      if (nextStats.length) {
        state.matchStats = nextStats;
        localStorage.setItem("wcom_match_stats", JSON.stringify(nextStats));
      }
    }
    state.apiStatus = "live worker";
  } catch {
    try {
      const cachedGames = JSON.parse(localStorage.getItem("wcom_games") || "[]");
      const cachedStats = JSON.parse(localStorage.getItem("wcom_match_stats") || "[]");
      if (cachedGames.length) state.liveResults = cachedGames.map(normalizeGame);
      if (cachedStats.length) state.matchStats = cachedStats;
      state.apiStatus = cachedGames.length ? "browser cache" : "cache seed";
    } catch {
      state.apiStatus = "cache seed";
    }
  }
  state.lastRefresh = new Date();
  render();
}

function render() {
  const tables = computeTables();
  const bracket = buildBracket(tables);
  const focusMatch = fixtureById.get(state.focusMatchId) || fixtures[0];
  const selectedSignal = signalFor(focusMatch);
  app.innerHTML = `
    <header class="app-header">
      <div>
        <span class="eyebrow">World Cup data lab</span>
        <h1>Officiating Monitor</h1>
      </div>
      <div class="status-pill"><b>${state.apiStatus}</b><span>${state.lastRefresh.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>
      <button class="icon-button" data-action="refresh" title="Refresh live cache">↻</button>
    </header>
    <nav class="tabs">
      ${tabButton("dashboard", "Match Lab")}
      ${tabButton("signals", "Signals")}
      ${tabButton("bracket", "Bracket")}
      ${tabButton("pipeline", "Pipeline")}
    </nav>
    ${state.activeView === "dashboard" ? dashboardView(tables, bracket, focusMatch, selectedSignal) : ""}
    ${state.activeView === "signals" ? signalsView() : ""}
    ${state.activeView === "bracket" ? bracketView(tables, bracket) : ""}
    ${state.activeView === "pipeline" ? pipelineView() : ""}
  `;
  bindEvents();
}

function tabButton(id, label) {
  return `<button data-tab="${id}" class="${state.activeView === id ? "active" : ""}">${label}</button>`;
}

function dashboardView(tables, bracket, match, signal) {
  const overlay = overlayFor(match);
  const tableRows = tables[match.group] || [];
  const nextMatches = fixtures.filter((item) => matchState(item) !== "finished").slice(0, 8);
  const highRisk = fixtures.map((item) => ({ match: item, signal: signalFor(item) })).sort((a, b) => b.signal.risk - a.signal.risk).slice(0, 5);
  return `
    <main class="dashboard">
      <section class="scoreboard">
        <div class="match-meta">Group ${match.group} · ${match.venue} · ${new Date(match.datetime_mt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
        <div class="scoreline">
          ${teamBadge(match.home)}
          <strong>${overlay ? `${overlay.home_score} - ${overlay.away_score}` : "vs"}</strong>
          ${teamBadge(match.away)}
        </div>
        <div class="signal-band ${signal.label}">
          <b>${signal.label.toUpperCase()}</b>
          <span>${Math.round(signal.risk * 100)} officiating volatility index</span>
        </div>
        <div class="metric-grid">
          ${metric("Referee", signal.stats.referee, signal.ref.confidence)}
          ${metric("Cards", `${signal.stats.yellow_cards}Y / ${signal.stats.red_cards}R`, signal.stats.confidence)}
          ${metric("Fouls", `${signal.stats.home_fouls}-${signal.stats.away_fouls}`, "home-away")}
          ${metric("VAR", `${signal.stats.var_reviews} reviews`, `${signal.stats.penalties} penalties`)}
        </div>
        <div class="reason-list">${signal.reasons.map((item) => `<span>${item}</span>`).join("")}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Live Group Table</h2><label><input type="checkbox" data-action="toggle-live" ${state.includeLiveInTable ? "checked" : ""}> include live scores</label></div>
        <table>${tableRows.map((row, index) => tableRow(row, index)).join("")}</table>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Match Queue</h2><span>API matching uses id first, then canonical home/away aliases</span></div>
        <div class="match-list">${nextMatches.map(matchButton).join("")}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Highest Watchlist</h2><span>historical cache + live stats</span></div>
        <div class="risk-list">${highRisk.map(({ match: item, signal: itemSignal }) => riskItem(item, itemSignal)).join("")}</div>
      </section>
    </main>
  `;
}

function signalsView() {
  const rows = fixtures.map((match) => ({ match, signal: signalFor(match) })).sort((a, b) => b.signal.risk - a.signal.risk);
  return `
    <main class="wide">
      <section class="panel">
        <div class="panel-head"><h2>Officiating Signal Matrix</h2><span>poor, good, and unknown labels are separated from source confidence</span></div>
        <div class="matrix">${rows.map(({ match, signal }) => `
          <button class="matrix-row ${signal.label}" data-match="${match.match_id}">
            <span>${match.match_id}</span>
            ${teamBadge(match.home)}
            <b>vs</b>
            ${teamBadge(match.away)}
            <em>${signal.stats.referee}</em>
            <strong>${signal.label}</strong>
            <i style="width:${Math.round(signal.risk * 100)}%"></i>
          </button>
        `).join("")}</div>
      </section>
      <section class="panel compact-panel">
        <h2>Signal Dictionary</h2>
        ${historical.statDefinitions.map((def) => `<article class="definition"><b>${def.key}</b><span>Good: ${def.good}</span><span>Poor: ${def.poor}</span><span>Unknown: ${def.unknown}</span></article>`).join("")}
      </section>
    </main>
  `;
}

function bracketView(tables, bracket) {
  const focusSeed = bracket.seeds.find((entry) => entry.team === state.focusTeam) || bracket.seeds[0];
  return `
    <main class="wide">
      <section class="panel">
        <div class="panel-head"><h2>Current Bracket Sort</h2><span>top two from each group + eight best third-place teams</span></div>
        <div class="seed-grid">${bracket.seeds.map((seed) => `
          <button class="seed ${seed.team === state.focusTeam ? "active" : ""}" data-team="${seed.team}">
            <span>#${seed.seed}</span>${teamBadge(seed.team)}<em>${seed.slot} · Group ${seed.group} · ${seed.pts} pts · GD ${seed.gd}</em>
          </button>`).join("")}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>${focusSeed?.team || "Projected"} Path</h2><span>model rating adjusted by discipline drag</span></div>
        <div class="bracket-rounds">${bracket.rounds.map(([label, matches]) => `
          <div class="round"><h3>${label}</h3>${matches.map((match) => `
            <article class="bracket-card ${match.teams.some((team) => team.team === state.focusTeam) ? "focus" : ""}">
              <b>${match.id}</b>
              ${match.teams.map((team) => `<button data-team="${team.team}" class="${match.winner?.team === team.team ? "winner" : ""}">${teamBadge(team.team)}<span>${team.seed ? `#${team.seed}` : ""} ${team.slot || ""}</span></button>`).join("")}
            </article>
          `).join("")}</div>`).join("")}</div>
      </section>
    </main>
  `;
}

function pipelineView() {
  return `
    <main class="wide">
      <section class="panel">
        <div class="panel-head"><h2>Reddit Worker Contract</h2><span>token stays server-side</span></div>
        <pre>{
  "GET /games": "array of live scores, ids, teams, status",
  "GET /match-stats": "array of referee, cards, fouls, offsides, penalties, var reviews",
  "matching": "match_id first, canonical team aliases second",
  "storage": "Cloudflare KV cache; frontend localStorage fallback",
  "refresh": "cron or browser refresh, no exposed Reddit token"
}</pre>
      </section>
      <section class="panel">
        <h2>Current Normalized Cache</h2>
        <pre>${escapeHtml(JSON.stringify({ games: state.liveResults.slice(0, 8), matchStats: state.matchStats.slice(0, 8), status: state.apiStatus }, null, 2))}</pre>
      </section>
    </main>
  `;
}

function teamBadge(teamName) {
  const team = byTeam.get(teamName) || strengthByTeam.get(teamName) || {};
  return `<span class="team"><span>${team.flag || "•"}</span>${teamName}</span>`;
}

function metric(label, value, sub) {
  return `<div class="metric"><span>${label}</span><b>${value}</b><em>${sub || ""}</em></div>`;
}

function tableRow(row, index) {
  return `<tr><td>${index + 1}</td><td>${teamBadge(row.team)}</td><td>${row.p}</td><td>${row.pts}</td><td>${row.gd}</td><td>${row.gf}</td><td>${row.fairPlay.toFixed(1)}</td></tr>`;
}

function matchButton(match) {
  const signal = signalFor(match);
  return `<button class="match-button ${match.match_id === state.focusMatchId ? "active" : ""}" data-match="${match.match_id}">
    <span>${match.match_id}</span><b>${match.home} vs ${match.away}</b><em>${signal.label} · ${signal.stats.confidence}</em>
  </button>`;
}

function riskItem(match, signal) {
  return `<button class="risk-item ${signal.label}" data-match="${match.match_id}">
    <b>${match.home} vs ${match.away}</b><span>${signal.stats.referee} · ${Math.round(signal.risk * 100)} index</span><em>${signal.label}</em>
  </button>`;
}

function bindEvents() {
  app.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
    state.activeView = button.dataset.tab;
    render();
  }));
  app.querySelectorAll("[data-match]").forEach((button) => button.addEventListener("click", () => {
    state.focusMatchId = button.dataset.match;
    state.activeView = "dashboard";
    render();
  }));
  app.querySelectorAll("[data-team]").forEach((button) => button.addEventListener("click", () => {
    state.focusTeam = button.dataset.team;
    render();
  }));
  app.querySelector("[data-action='refresh']")?.addEventListener("click", refreshLive);
  app.querySelector("[data-action='toggle-live']")?.addEventListener("change", (event) => {
    state.includeLiveInTable = event.target.checked;
    render();
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

render();
refreshLive();
