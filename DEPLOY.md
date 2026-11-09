# Deploying J.A.R.V.I.S. (Vercel + Render)

The frontend is a static site and goes on **Vercel**. The backend keeps live state, runs the
simulator in the background and holds WebSocket connections, so it can't run on Vercel and goes
on **Render** instead. Both are free and both redeploy on every push to `main`.

## 1. Backend on Render (deploy this first)

1. Sign in at [render.com](https://render.com) with GitHub, then **New → Web Service** and pick this repo.
2. Settings:
   - **Root Directory:** `backend`
   - **Runtime:** Python 3 (the version comes from `backend/.python-version`, 3.12.4)
   - **Build Command:** `pip install -e .`
   - **Start Command:** `uvicorn jarvis.api:app --host 0.0.0.0 --port $PORT`
   - **Region:** Singapore. **Instance type:** Free.
3. **Create Web Service**. When it is live, copy its URL, e.g. `https://jarvis-api.onrender.com`.
4. Check it: open `https://jarvis-api.onrender.com/api/scenarios`. You should see 3 scenarios.

Use `pip install -e .`, not `pip install .`: the scenario and service files in `backend/data` are
read from the repo folder.

## 2. Frontend on Vercel

1. Sign in at [vercel.com](https://vercel.com) with GitHub, then **Add New → Project** and import this repo.
2. Settings:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Vite (detected). Build `npm run build`, output `dist`.
   - **Environment Variable:** `VITE_API_URL` = your Render URL, e.g. `https://jarvis-api.onrender.com`
     (no trailing slash; it also sets the live-update WebSocket address).
3. **Deploy**. Open the Vercel URL, go to **Sources**, play scenario **A** at **2x**.

If you change `VITE_API_URL` later, redeploy on Vercel: the value is baked in at build time.

## Settings you might need

| Where | Variable | Default | When to change |
|---|---|---|---|
| Vercel | `VITE_API_URL` | none (same origin) | Always: set it to the Render URL |
| Render | `JARVIS_CORS_ORIGINS` | `http://localhost:5173` | Add a custom domain, e.g. `https://jarvis.example.com` |
| Render | `JARVIS_CORS_ORIGIN_REGEX` | `https://.*\.vercel\.app` | Narrow it to your project, e.g. `https://jarvis.*\.vercel\.app` |

## Before a demo

- **Cold start:** Render's free plan sleeps after 15 idle minutes and takes about a minute to wake.
  Open the site a few minutes before presenting.
- **No saved data:** everything lives in memory, so a restart or wake-up starts empty. Press Play.
- **If the dashboard shows no live updates:** check that `VITE_API_URL` is set on Vercel and starts
  with `https://`, then redeploy.
