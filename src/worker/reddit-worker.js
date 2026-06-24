// Cloudflare Worker template for Reddit-token ingestion.
// Store secrets with:
// wrangler secret put REDDIT_CLIENT_ID
// wrangler secret put REDDIT_CLIENT_SECRET
// wrangler secret put REDDIT_REFRESH_TOKEN
//
// Bind KV as MATCH_CACHE. The frontend expects:
//   GET /games
//   GET /match-stats
//   GET /health

const CACHE_TTL_SECONDS = 90;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, updated: new Date().toISOString() });
    if (url.pathname === "/games") return cachedJson("games", env, ctx, () => fetchRedditJson(env, "wc_live_games"));
    if (url.pathname === "/match-stats") return cachedJson("match-stats", env, ctx, () => fetchRedditJson(env, "wc_match_stats"));
    return json({ error: "not found" }, 404);
  }
};

async function cachedJson(key, env, ctx, load) {
  const cached = await env.MATCH_CACHE?.get(key, "json");
  if (cached?.updatedAt && Date.now() - new Date(cached.updatedAt).getTime() < CACHE_TTL_SECONDS * 1000) {
    return json(cached.payload);
  }
  const payload = await load();
  ctx.waitUntil(env.MATCH_CACHE?.put(key, JSON.stringify({ updatedAt: new Date().toISOString(), payload })));
  return json(payload);
}

async function fetchRedditJson(env, wikiPage) {
  const token = await redditAccessToken(env);
  const res = await fetch(`https://oauth.reddit.com/r/${env.REDDIT_SUBREDDIT || "worldcup"}/wiki/${wikiPage}.json`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "world-cup-officiating-monitor/0.1 by portfolio"
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
      "User-Agent": "world-cup-officiating-monitor/0.1 by portfolio"
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
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    }
  });
}
