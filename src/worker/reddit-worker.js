import gamesSeed from "./cache/gamesSeed.mjs";
import matchStatsSeed from "./cache/matchStatsSeed.mjs";

const CACHE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=60"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return json({}, 204);
    if (url.pathname === "/health") return health(env);
    if (url.pathname === "/refresh") return json(await refreshCache(env));
    if (url.pathname === "/games") return json(await games(env));
    if (url.pathname === "/match-stats") return json(await matchStats(env));
    if (url.pathname === "/") return json({
      name: "world-cup-officiating-monitor-api",
      plan: "free scheduled cache worker",
      endpoints: ["/health", "/refresh", "/games", "/match-stats"]
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
  const [nextGames, nextStats] = await Promise.all([fetchGames(env), fetchMatchStats(env)]);
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
  const live = await tryJson("https://wc26liveapi.jack-holitza.workers.dev/games");
  if (live) return annotate(live, "wclive-worker");
  if (hasReddit(env)) {
    const reddit = await tryReddit(env, "wc_live_games");
    if (reddit) return annotate(reddit, "reddit-oauth-free");
  }
  return null;
}

async function fetchMatchStats(env) {
  if (env.DISCIPLINE_JSON_URL) {
    const publicJson = await tryJson(env.DISCIPLINE_JSON_URL);
    if (publicJson) return annotate(publicJson, "public-json-feed");
  }
  if (hasReddit(env)) {
    const reddit = await tryReddit(env, "wc_match_stats");
    if (reddit) return annotate(reddit, "reddit-oauth-free");
  }
  return annotate(matchStatsSeed, "free-static-worker-cache");
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
