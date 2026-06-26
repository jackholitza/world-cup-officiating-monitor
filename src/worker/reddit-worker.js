import gamesSeed from "./cache/gamesSeed.mjs";
import matchStatsSeed from "./cache/matchStatsSeed.mjs";
import refereesSeed from "../data/referees.js";

const CACHE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=60"
};

const REFEREE_ALIASES = {
  "adham mohammad": "adham makhadmeh",
  "alejandro jose hernandez hernandez": "alejandro hernandez hernandez",
  "alejandro hernandez hernandez": "alejandro hernandez hernandez",
  "amin omar": "amin mohamed omar",
  "amin mohamed": "amin mohamed omar",
  "beida damane": "dahane beida",
  "cesar arturo ramos palazuelos": "cesar arturo ramos",
  "clement turpin": "clement turpin",
  "cristian garay": "cristian garay",
  "dahane beida": "dahane beida",
  "espen eskas": "espen eskas",
  "francois letexier": "francois letexier",
  "hector martinez": "said martinez",
  "istvan kovacs": "istvan kovacs",
  "ivan arcides barton cisneros": "ivan barton",
  "jalal jayed": "jalal jayed",
  "jesus valenzuela": "jesus valenzuela",
  "joao pinheiro": "joao pinheiro",
  "juan gabriel benitez": "juan gabriel benitez",
  "martinez hector": "said martinez",
  "ramon abatti abel": "ramon abatti abel",
  "slavko vincici": "slavko vincic",
  "wilton pereira sampaio": "wilton sampaio",
  "yael falcon perez": "yael falcon perez"
};

const EXTRA_REFEREES = [
  ["Alejandro Hernandez Hernandez", "Spain", "UEFA"],
  ["Amin Mohamed Omar", "Egypt", "CAF"],
  ["Cristian Garay", "Chile", "CONMEBOL"],
  ["Espen Eskas", "Norway", "UEFA"],
  ["Francois Letexier", "France", "UEFA"],
  ["Gustavo Tejera", "Uruguay", "CONMEBOL"],
  ["Istvan Kovacs", "Romania", "UEFA"],
  ["Jalal Jayed", "Morocco", "CAF"],
  ["Juan Gabriel Benitez", "Paraguay", "CONMEBOL"],
  ["Ramon Abatti Abel", "Brazil", "CONMEBOL"],
  ["Yael Falcon Perez", "Argentina", "CONMEBOL"]
].map(([name, country, confederation]) => ({ name, country, confederation, crew: `${country} crew` }));

const REFEREE_LOOKUP = new Map([...refereesSeed, ...EXTRA_REFEREES].map((referee) => [normalizeName(referee.name), referee]));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return json({}, 204);
    if (url.pathname === "/health") return health(env);
    if (url.pathname === "/refresh") return json(await refreshCache(env));
    if (url.pathname === "/games") return json(await games(env));
    if (url.pathname === "/scoreboard") return json(await fetchEspnGames() || { ok: false, response: [] });
    if (url.pathname === "/match-stats") return json(await matchStats(env));
    if (url.pathname === "/") return json({
      name: "world-cup-officiating-monitor-api",
      plan: "free scheduled cache worker",
      endpoints: ["/health", "/refresh", "/games", "/scoreboard", "/match-stats"]
    });
    return json({ error: "not found" }, 404);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshCache(env));
  }
};

async function health(env) {
  const cachedGames = await readCache(env, "games");
  const cachedStats = await readCache(env, "match-stats");
  return json({
    ok: true,
    mode: hasReddit(env) ? "reddit-plus-scheduled-cache" : "scheduled-free-cache",
    cache: {
      games_updated_at: cachedGames?.meta?.cached_at || null,
      stats_updated_at: cachedStats?.meta?.cached_at || null,
      kv_enabled: Boolean(env.MATCH_CACHE)
    },
    paid_tokens: false,
    updated: new Date().toISOString()
  });
}

async function games(env) {
  const cached = await readCache(env, "games");
  if (cached) return cached;
  const live = await fetchGames(env);
  if (live) return live;
  return annotate(gamesSeed, "free-static-worker-cache");
}

async function matchStats(env) {
  const cached = await readCache(env, "match-stats");
  if (cached) return cached;
  const liveStats = await fetchMatchStats(env);
  if (liveStats) return liveStats;
  return annotate(matchStatsSeed, "free-static-worker-cache");
}

async function refreshCache(env) {
  const cachedStats = await readCache(env, "match-stats");
  const [nextGames, nextStats] = await Promise.all([fetchGames(env), fetchMatchStats(env, cachedStats)]);
  const wrote = {};
  wrote.games = await writeCache(env, "games", nextGames || annotate(gamesSeed, "wclive-seed-cache"));
  if (nextStats) wrote.match_stats = await writeCache(env, "match-stats", nextStats);
  return {
    ok: Boolean(nextGames || nextStats),
    wrote,
    paid_tokens: false,
    refreshed_at: new Date().toISOString()
  };
}

async function fetchGames(env) {
  const espn = await fetchEspnGames();
  if (espn?.response?.length) return annotate(espn, "espn-public-scoreboard");
  const live = await tryJson("https://wc26liveapi.jack-holitza.workers.dev/games");
  if (live) return annotate(live, "wclive-worker");
  if (hasReddit(env)) {
    const reddit = await tryReddit(env, "wc_live_games");
    if (reddit) return annotate(reddit, "reddit-oauth-free");
  }
  return null;
}

async function fetchEspnGames() {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 1);
  const stop = new Date();
  stop.setUTCDate(stop.getUTCDate() + 3);
  const events = [];
  for (const date of dateRange(start.toISOString().slice(0, 10), stop.toISOString().slice(0, 10))) {
    const scoreboard = await tryJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${date.replaceAll("-", "")}`);
    events.push(...(scoreboard?.events || []));
  }

  const assignmentWindow = Date.now() + 48 * 60 * 60 * 1000;
  const assignmentEvents = events.filter((event) => {
    const completed = event.competitions?.[0]?.status?.type?.completed;
    return !completed && new Date(event.date).getTime() <= assignmentWindow;
  }).slice(0, 12);
  const assignments = new Map((await Promise.all(assignmentEvents.map(async (event) => {
    const summary = await tryJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${event.id}`);
    const official = summary?.gameInfo?.officials?.find((item) => item.position?.displayName === "Referee") || summary?.gameInfo?.officials?.[0];
    if (!official) return null;
    const name = official.displayName || official.fullName;
    const profile = refereeProfileFor(name);
    return [String(event.id), { referee: name, referee_country: profile?.country || "Country not listed" }];
  }))).filter(Boolean));

  const response = events.map((event) => {
    const competition = event.competitions?.[0] || {};
    const home = competition.competitors?.find((team) => team.homeAway === "home") || competition.competitors?.[0] || {};
    const away = competition.competitors?.find((team) => team.homeAway === "away") || competition.competitors?.[1] || {};
    const status = competition.status?.type || event.status?.type || {};
    const assignment = assignments.get(String(event.id)) || {};
    return {
      id: event.id,
      match_id_api: event.id,
      home_team_name_en: canonicalTeam(home.team?.displayName),
      away_team_name_en: canonicalTeam(away.team?.displayName),
      home_score: home.score ?? null,
      away_score: away.score ?? null,
      local_date: event.date,
      finished: Boolean(status.completed),
      time_elapsed: status.completed ? "finished" : status.state === "in" ? (competition.status?.displayClock || "live") : "scheduled",
      status: status.name || "scheduled",
      group: groupFor(canonicalTeam(home.team?.displayName), canonicalTeam(away.team?.displayName)),
      referee: assignment.referee || "Assignment pending",
      referee_country: assignment.referee_country || "Country pending"
    };
  }).filter((row) => row.home_team_name_en && row.away_team_name_en);

  return {
    ok: true,
    source: "espn-public-scoreboard",
    fetched_at: new Date().toISOString(),
    response_count: response.length,
    response
  };
}

async function fetchMatchStats(env, cachedStats = null) {
  if (env.DISCIPLINE_JSON_URL) {
    const publicJson = await tryJson(env.DISCIPLINE_JSON_URL);
    if (publicJson) return annotate(publicJson, "public-json-feed");
  }
  const espn = await fetchEspnMatchStats(cachedStats);
  if (espn?.results?.length) return annotate(espn, "espn-public-verified");
  if (hasReddit(env)) {
    const reddit = await tryReddit(env, "wc_match_stats");
    if (reddit) return annotate(reddit, "reddit-oauth-free");
  }
  return annotate(matchStatsSeed, "free-static-worker-cache");
}

async function fetchEspnMatchStats(cachedStats = null) {
  const dates = dateRange("2026-06-11", new Date().toISOString().slice(0, 10));
  const existingRows = cachedStats?.meta?.source === "espn-public-verified" ? cachedStats.results || [] : [];
  const rows = [...existingRows];
  const seen = new Set(existingRows.map((row) => String(row.espn_event_id || "")));
  const eventIds = [];
  for (const date of dates) {
    const scoreboard = await tryJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${date.replaceAll("-", "")}`);
    for (const event of scoreboard?.events || []) {
      const competition = event.competitions?.[0];
      if (!competition?.status?.type?.completed) continue;
      if (!seen.has(String(event.id))) eventIds.push(event.id);
    }
  }
  for (const eventId of eventIds.slice(0, 10)) {
      const row = await espnEventStats(eventId);
      if (row) rows.push(row);
  }
  rows.sort((a, b) => new Date(a.local_date || 0) - new Date(b.local_date || 0));
  const enrichedRows = rows.map(enrichRefereeRow);
  return {
    meta: {
      source: "espn-public-verified",
      source_url: "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard",
      rows: enrichedRows.length,
      missing_completed: Math.max(0, eventIds.length - 10),
      refresh_batch_size: Math.min(10, eventIds.length),
      updated_at: new Date().toISOString(),
      paid_tokens: false
    },
    results: enrichedRows
  };
}

function enrichRefereeRow(row) {
  const profile = refereeProfileFor(row.referee);
  if (!profile) return row;
  return {
    ...row,
    referee_country: row.referee_country && row.referee_country !== "TBD" ? row.referee_country : profile.country,
    confederation: row.confederation && row.confederation !== "FIFA" ? row.confederation : profile.confederation,
    crew: row.crew && row.crew !== "ESPN public match summary" ? row.crew : profile.crew
  };
}

async function espnEventStats(eventId) {
  const summary = await tryJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${eventId}`);
  const competition = summary?.header?.competitions?.[0];
  const competitors = competition?.competitors || [];
  if (competitors.length < 2) return null;
  const home = competitors.find((team) => team.homeAway === "home") || competitors[0];
  const away = competitors.find((team) => team.homeAway === "away") || competitors[1];
  const homeName = canonicalTeam(home.team?.displayName);
  const awayName = canonicalTeam(away.team?.displayName);
  const homeStats = await espnCompetitorStats(eventId, home.id);
  const awayStats = await espnCompetitorStats(eventId, away.id);
  const commentary = summary?.commentary || [];
  const matchId = matchIdFor(homeName, awayName);
  const cardEvents = espnCardEvents(commentary, matchId);
  const foulEvents = espnFoulEvents(commentary, matchId, homeName, awayName);
  const varEvents = espnVarEvents(commentary);
  const referee = summary?.gameInfo?.officials?.find((official) => official.position?.displayName === "Referee") || summary?.gameInfo?.officials?.[0];
  const refereeName = referee?.displayName || referee?.fullName || "Assignment pending";
  const refereeProfile = refereeProfileFor(refereeName);
  return {
    match_id: matchId,
    espn_event_id: eventId,
    home: homeName,
    away: awayName,
    group: groupFor(homeName, awayName),
    local_date: competition.date,
    referee: refereeName,
    referee_country: refereeProfile?.country || "Country not listed",
    confederation: refereeProfile?.confederation || "FIFA",
    crew: refereeProfile?.crew || "ESPN public match summary",
    home_fouls: statValue(homeStats, "foulsCommitted"),
    away_fouls: statValue(awayStats, "foulsCommitted"),
    home_offsides: statValue(homeStats, "offsides"),
    away_offsides: statValue(awayStats, "offsides"),
    yellow_cards: statValue(homeStats, "yellowCards") + statValue(awayStats, "yellowCards"),
    red_cards: statValue(homeStats, "redCards") + statValue(awayStats, "redCards"),
    penalties: statValue(homeStats, "penaltyKickShots") + statValue(awayStats, "penaltyKickShots"),
    var_reviews: varEvents.length,
    card_events: cardEvents,
    foul_events: foulEvents,
    var_events: varEvents,
    confidence: "verified-public-connector",
    source: "espn-public-verified",
    stat_url: `https://www.espn.com/soccer/match/_/gameId/${eventId}`,
    connector_links: [
      { label: "ESPN match summary", url: `https://www.espn.com/soccer/match/_/gameId/${eventId}` },
      { label: "ESPN public summary JSON", url: `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${eventId}` }
    ]
  };
}

function refereeProfileFor(name) {
  const normalized = normalizeName(name);
  return REFEREE_LOOKUP.get(normalized) || REFEREE_LOOKUP.get(REFEREE_ALIASES[normalized]);
}

function normalizeName(name = "") {
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function espnCompetitorStats(eventId, teamId) {
  const payload = await tryJson(`https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world/events/${eventId}/competitions/${eventId}/competitors/${teamId}/statistics?lang=en&region=us`);
  return (payload?.splits?.categories || []).flatMap((category) => category.stats || []);
}

function statValue(stats, name) {
  const value = stats.find((stat) => stat.name === name)?.value;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function espnCardEvents(commentary, matchId) {
  return commentary.map((item) => {
    const play = item.play || {};
    const type = play.type?.type;
    if (!["yellow-card", "red-card"].includes(type)) return null;
    return {
      match_id: matchId,
      team: canonicalTeam(play.team?.displayName),
      player_name: play.participants?.[0]?.athlete?.displayName || playerFromText(item.text),
      minute: minuteValue(item.time?.displayValue || play.clock?.displayValue),
      card: type === "red-card" ? "red" : "yellow",
      reason: item.text || play.text || play.shortText || "card",
      source_play_id: play.id
    };
  }).filter(Boolean);
}

function espnFoulEvents(commentary, matchId, homeName, awayName) {
  const seen = new Set();
  const rows = [];
  for (const item of commentary) {
    const play = item.play || {};
    if (play.type?.type !== "foul" || !play.id || seen.has(play.id)) continue;
    seen.add(play.id);
    const team = canonicalTeam(play.team?.displayName);
    rows.push({
      match_id: matchId,
      team,
      opponent: team === homeName ? awayName : homeName,
      player_name: play.participants?.[0]?.athlete?.displayName || playerFromText(item.text),
      minute: minuteValue(item.time?.displayValue || play.clock?.displayValue),
      type: item.text || play.shortText || "foul",
      source_play_id: play.id
    });
  }
  return rows;
}

function espnVarEvents(commentary) {
  return commentary.map((item) => {
    const play = item.play || {};
    const type = `${play.type?.type || ""} ${play.type?.text || ""} ${item.text || ""}`;
    if (!/\bvar\b/i.test(type)) return null;
    return {
      team: canonicalTeam(play.team?.displayName),
      player_name: play.participants?.[0]?.athlete?.displayName || playerFromText(item.text),
      minute: minuteValue(item.time?.displayValue || play.clock?.displayValue),
      decision: item.text || play.text || play.shortText || "VAR review",
      source_play_id: play.id
    };
  }).filter(Boolean);
}

function playerFromText(text = "") {
  const match = text.match(/(?:by|for|Decision: Card upgraded)\s+([^().]+)(?:\s+\(|\.|$)/i);
  return match?.[1]?.trim() || "";
}

function minuteValue(display = "") {
  const match = String(display).match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function dateRange(start, end) {
  const dates = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const stop = new Date(`${end}T00:00:00Z`);
  while (cursor <= stop) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function canonicalTeam(value) {
  const raw = String(value || "").trim();
  const manual = { Turkey: "Türkiye", Turkiye: "Türkiye", "Congo DR": "DR Congo", "United States": "United States", USA: "United States", Curacao: "Curaçao" };
  return manual[raw] || raw;
}

function matchIdFor(home, away) {
  const match = matchStatsSeed.results.find((row) => row.home === home && row.away === away)
    || matchStatsSeed.results.find((row) => row.home === away && row.away === home);
  return match?.match_id || `${slug(home)}-${slug(away)}`;
}

function groupFor(home, away) {
  const match = matchStatsSeed.results.find((row) => row.home === home && row.away === away)
    || matchStatsSeed.results.find((row) => row.home === away && row.away === home);
  return match?.group || "";
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function readCache(env, key) {
  if (!env.MATCH_CACHE) return null;
  try {
    return await env.MATCH_CACHE.get(key, "json");
  } catch {
    return null;
  }
}

async function writeCache(env, key, payload) {
  if (!env.MATCH_CACHE) return false;
  try {
    await env.MATCH_CACHE.put(key, JSON.stringify({ ...payload, meta: { ...(payload.meta || {}), cached_at: new Date().toISOString() } }));
    return true;
  } catch {
    return false;
  }
}

function annotate(payload, source) {
  return {
    ...payload,
    meta: {
      ...(payload.meta || {}),
      source,
      served_at: new Date().toISOString(),
      paid_tokens: false
    }
  };
}

function hasReddit(env) {
  return Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET && env.REDDIT_REFRESH_TOKEN);
}

async function tryReddit(env, wikiPage) {
  try {
    return await fetchRedditJson(env, wikiPage);
  } catch (error) {
    return null;
  }
}

async function tryJson(url) {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchRedditJson(env, wikiPage) {
  const token = await redditAccessToken(env);
  const subreddit = env.REDDIT_SUBREDDIT || "worldcup";
  const res = await fetch(`https://oauth.reddit.com/r/${subreddit}/wiki/${wikiPage}.json`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "world-cup-officiating-monitor/0.2 by jackholitza"
    }
  });
  if (!res.ok) throw new Error(`Reddit fetch failed: ${res.status}`);
  const payload = await res.json();
  const markdown = payload?.data?.content_md || "[]";
  return JSON.parse(extractJson(markdown));
}

async function redditAccessToken(env) {
  const basic = btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`);
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "world-cup-officiating-monitor/0.2 by jackholitza"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: env.REDDIT_REFRESH_TOKEN
    })
  });
  if (!res.ok) throw new Error(`Reddit auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

function extractJson(markdown) {
  const fenced = markdown.match(/```json\s*([\s\S]*?)```/i);
  return fenced ? fenced[1] : markdown;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: CACHE_HEADERS });
}
