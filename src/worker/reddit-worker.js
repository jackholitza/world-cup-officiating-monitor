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
    if (url.pathname === "/games") return json(await games(env));
    if (url.pathname === "/match-stats") return json(await matchStats(env));
    if (url.pathname === "/") return json({
      name: "world-cup-officiating-monitor-api",
      plan: "free static-first worker",
      endpoints: ["/health", "/games", "/match-stats"]
    });
    return json({ error: "not found" }, 404);
  }
};

async function health(env) {
  return json({
    ok: true,
    mode: hasReddit(env) ? "reddit-plus-static-fallback" : "static-free-cache",
    paid_tokens: false,
    updated: new Date().toISOString()
  });
}

async function games(env) {
  if (hasReddit(env)) {
    const reddit = await tryReddit(env, "wc_live_games");
    if (reddit) return reddit;
  }
  return annotate(gamesSeed, "free-static-worker-cache");
}

async function matchStats(env) {
  if (hasReddit(env)) {
    const reddit = await tryReddit(env, "wc_match_stats");
    if (reddit) return reddit;
  }
  return annotate(matchStatsSeed, "free-static-worker-cache");
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
