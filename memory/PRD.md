# CryptoBot Terminal — Product Requirements

## Overview
A dark-first mobile trading terminal for a **paper-trading multi-exchange, multi-pair crypto bot**. The mobile app is the command centre (unlock the vault, view P&L, deploy strategies, review journal, read LLM sentiment). The trading loop runs 24/7 in the FastAPI backend as an asyncio task.

## Scope choices (Feb 2026 build)
- **Exchanges shown**: Binance, Coinbase, Kraken (API-key vault + venue selector).
- **Strategies implemented**: Mean Reversion (Bollinger z-score), Trend Following (SMA cross + VWAP), Grid.
- **Sentiment**: Claude Sonnet 4.6 via Emergent LLM key with lexical fallback if the LLM is unavailable.
- **Market data**: CoinGecko public REST for warm history + poll; random-walk fallback so the simulator never stalls.
- **Auth**: Local 4-digit PIN (bcrypt-hashed server-side, session token stored in `secureSet`).
- **API keys**: Fernet-encrypted at rest, only **TRADING + QUERY** permission model surfaced; the UI states withdrawal must be disabled on the exchange side.

## Screens
1. **Splash / Router** (`app/index.tsx`) — routes to setup, unlock, or dashboard based on vault state.
2. **Setup PIN** — create-then-confirm 4-digit PIN.
3. **Unlock** — enter PIN, optional biometric prompt (native only).
4. **Dashboard** (tab) — portfolio equity, sparkline P&L, fleet cards, recent executions, kill-switch.
5. **Strategies** (tab) — list of bots with equity / P&L / regime cells + pause / delete.
6. **Market** (tab) — pair chips, Chart / Order Book / Sentiment tabs, VWAP + Bollinger metrics.
7. **Journal** (tab) — chronological trades, expand for reason / regime / fees / notional.
8. **Vault** (`/vault`) — add / list / delete encrypted exchange API keys.
9. **New Strategy** (`/strategy-new`) — deploy Mean Reversion / Trend / Grid with allocation + risk.
10. **Strategy Detail** (`/strategy/[id]`) — full params, risk, open position, controls.

## Backend endpoints (all `/api` prefixed)
- `GET /` health.
- `GET /auth/state`, `POST /auth/setup`, `POST /auth/unlock`, `POST /auth/lock`.
- `GET|POST|DELETE /vault/keys` — Fernet-encrypted vault.
- `GET /market/pairs`, `GET /market/{pair}`, `GET /market/{pair}/orderbook`.
- `GET|POST /strategies`, `GET /strategies/{id}`, `POST /strategies/{id}/pause|resume`, `DELETE /strategies/{id}`.
- `GET /portfolio`, `POST /portfolio/kill-switch`.
- `GET /trades`.
- `POST /sentiment`, `GET /sentiment/{pair}` — Claude 4.6.

## Risk & safety features
- Per-strategy per-trade % risk cap (default 2%).
- Trailing max-drawdown auto-halt (default 5%).
- Global kill-switch flattens positions & pauses everything.
- Withdrawal permission is never requested; the Vault UI states this.

## Follow-ups (not in this MVP)
- Real exchange execution behind a "live" toggle (currently paper only).
- Emergent-managed push notifications on trade / halt events.
- Correlation hedging across strategies, HMM regime classifier, Kelly sizing UI.
- Web-socket L2 feed and iceberg / TWAP order slicing.
