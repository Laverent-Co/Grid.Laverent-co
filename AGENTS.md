# Base44 Dev Environment — CryptoBot Terminal

## Architecture
- **Frontend**: Expo (React Native) SDK 57 web app, served by Metro dev server on port 3000.
- **Backend**: FastAPI (Python 3.12) on port 8000 with `--reload` (live edit).
- **Database**: MongoDB 7 (compose service, auth enabled).
- Source for both frontend and backend is bind-mounted; edits appear via live reload.

## Running
```bash
docker compose -f docker-compose.base44.yml up -d
```

## Key Setup Notes
- **`emergentintegrations==0.2.0`** is a private Emergent platform package not on PyPI. The backend Dockerfile filters it out of `pip install`. The app has a built-in lexical fallback for sentiment analysis without it. If you need real LLM sentiment, provide `EMERGENT_LLM_KEY` via the Base44 secrets dashboard.
- **`httpx`** is imported by `server.py` but missing from `requirements.txt`; it's installed explicitly in the backend Dockerfile.
- **Expo CORS**: `frontend/app.config.js` reads `EXPO_ROUTER_ORIGIN` (set by compose to the preview's public URL) and adds it to Expo's CORS allowlist. Without this, Expo's dev server rejects cross-origin requests from the preview iframe.
- **Expo `--host`**: only accepts `lan`, `tunnel`, or `localhost` (not `0.0.0.0`). Using `lan` binds to all interfaces.
- **VAULT_KEY**: a Fernet key for encrypting exchange API keys at rest. Generated locally and set in compose `environment:`. Not a user secret.
- **RevenueCat**: web mode uses test keys; without `EXPO_PUBLIC_REVENUECAT_*` env vars it logs a warning and falls back gracefully.

## Optional External Secrets
- `EMERGENT_LLM_KEY` — Emergent LLM API key (Claude Sonnet) for sentiment analysis. Without it, a lexical heuristic is used.
- `EMERGENT_PUSH_KEY` — Emergent push notification relay key. Without it, push notifications are skipped.

## Verifying
- Frontend: visit the preview (port 3000) — should show the CryptoBot Terminal PIN setup screen.
- Backend: `curl http://localhost:8000/api/` returns `{"service":"cryptobot-terminal","status":"ok",...}`.
- Backend health: `curl http://localhost:8000/api/auth/state` returns `{"pin_configured":false}` on first boot.
