# World Cup Officiating Monitor

Static public analytics site for World Cup referee and discipline monitoring.

The frontend uses cached WCLive fixture/team data, then overlays live Reddit-worker data when available. Matching is deterministic: `match_id` first, canonicalized home/away aliases second. Standings are recomputed from the overlay and the bracket selects group winners, runners-up, and the eight best third-place teams.

Run locally:

```sh
python3 -m http.server 5173
```

Open `http://127.0.0.1:5173`.

The Cloudflare Worker template is in `src/worker/reddit-worker.js`.
