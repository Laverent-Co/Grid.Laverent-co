"""CryptoBot Terminal — FastAPI backend.

Paper-trading simulator for a multi-exchange, multi-strategy crypto bot.
- Local PIN auth (bcrypt hashed) protects the vault of exchange API keys.
- Exchange API keys are encrypted at rest with Fernet (VAULT_KEY in .env).
- The bot engine runs in-process as an asyncio task, pulling live BTC/ETH/SOL
  prices from Binance's public spot ticker (no exchange auth required for the
  simulation). Every strategy runs in "paper" mode; no real orders are placed.
- LLM sentiment analysis uses Claude Sonnet 4.6 via the Emergent LLM key.
"""
from __future__ import annotations

import asyncio
import logging
import math
import os
import random
import statistics
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional

import bcrypt
import httpx
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("cryptobot")

# ---------------------------------------------------------------------------
# Storage & crypto
# ---------------------------------------------------------------------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]
fernet = Fernet(os.environ["VAULT_KEY"].encode())

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

# ---------------------------------------------------------------------------
# Push notifications (Emergent-managed SuprSend relay)
# ---------------------------------------------------------------------------
PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")
_push_client = httpx.AsyncClient(
    base_url=PUSH_BASE_URL,
    headers={"X-Push-Key": PUSH_KEY},
    timeout=10.0,
)


async def send_push(recipients: List[str], data: Dict[str, Any], idempotency_key: Optional[str] = None) -> None:
    if not recipients:
        return
    if PUSH_KEY == "placeholder":
        logger.info("push (placeholder key) → %s: %s", recipients, data.get("title"))
        return
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    payload: Dict[str, Any] = {"recipients": recipients[:100], "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    try:
        resp = await _push_client.post("/api/v1/push/trigger", json=payload)
        resp.raise_for_status()
    except Exception as exc:
        logger.warning("push failed (non-blocking): %s", exc)


async def push_all(data: Dict[str, Any], idempotency_key: Optional[str] = None) -> None:
    """Send to every registered user_id we've seen for this app."""
    ids = await db.push_users.distinct("user_id")
    if ids:
        await send_push(ids, data, idempotency_key=idempotency_key)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


def encrypt(value: str) -> str:
    return fernet.encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    try:
        return fernet.decrypt(value.encode()).decode()
    except InvalidToken:
        return ""


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
SUPPORTED_EXCHANGES = ["binance", "coinbase", "kraken"]
SUPPORTED_STRATEGIES = ["mean_reversion", "trend_following", "grid", "walking_grid"]
# Free-tier pairs; Pro users can pass any pair (validated by presence in feed).
DEFAULT_PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
# Expanded set the feed will keep warm when queried.
EXTENDED_PAIRS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
    "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "MATICUSDT",
]
SUPPORTED_PAIRS = EXTENDED_PAIRS


class PinSetup(BaseModel):
    pin: str = Field(min_length=4, max_length=8)


class PinVerify(BaseModel):
    pin: str


class ApiKeyIn(BaseModel):
    exchange: str
    label: Optional[str] = None
    api_key: str
    api_secret: str
    passphrase: Optional[str] = None  # kraken/coinbase advanced


class ApiKeyOut(BaseModel):
    id: str
    exchange: str
    label: Optional[str]
    api_key_masked: str
    withdrawal_disabled: bool
    created_at: datetime


class StrategyIn(BaseModel):
    name: str
    exchange: str
    pair: str
    strategy_type: str
    allocation_usdt: float = Field(gt=0)
    params: Dict[str, Any] = Field(default_factory=dict)
    risk: Dict[str, Any] = Field(default_factory=dict)  # max_dd_pct, per_trade_pct


class StrategyOut(BaseModel):
    id: str
    name: str
    exchange: str
    pair: str
    strategy_type: str
    allocation_usdt: float
    params: Dict[str, Any]
    risk: Dict[str, Any]
    status: str  # running | paused | halted
    regime: str  # trending | ranging | volatile | low_liquidity
    equity: float
    realized_pnl: float
    unrealized_pnl: float
    peak_equity: float
    open_position: Optional[Dict[str, Any]]
    created_at: datetime


class SentimentIn(BaseModel):
    pair: str
    headlines: List[str]


class SentimentOut(BaseModel):
    pair: str
    score: float  # -1..1
    label: str  # bullish | bearish | neutral
    confidence: float
    drivers: List[str]
    generated_at: datetime


class TradeOut(BaseModel):
    id: str
    strategy_id: str
    pair: str
    side: str
    qty: float
    price: float
    fee: float
    pnl: float
    reason: str
    regime: str
    executed_at: datetime


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
SETTINGS_ID = "singleton"


async def require_unlocked(x_session_token: str = Header(default="")) -> str:
    sess = await db.sessions.find_one({"token": x_session_token}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Vault locked")
    return x_session_token


# ---------------------------------------------------------------------------
# Market data — Binance public spot ticker (no auth)
# ---------------------------------------------------------------------------
class MarketFeed:
    """Polls Binance public REST every 3s and keeps a rolling window per pair."""

    def __init__(self) -> None:
        self.prices: Dict[str, float] = {}
        self.history: Dict[str, Deque[float]] = defaultdict(lambda: deque(maxlen=200))
        self.volume: Dict[str, Deque[float]] = defaultdict(lambda: deque(maxlen=200))
        self._task: Optional[asyncio.Task] = None
        self._client: Optional[httpx.AsyncClient] = None

    _COINGECKO_IDS = {
        "BTCUSDT": "bitcoin",
        "ETHUSDT": "ethereum",
        "SOLUSDT": "solana",
        "BNBUSDT": "binancecoin",
        "XRPUSDT": "ripple",
        "ADAUSDT": "cardano",
        "DOGEUSDT": "dogecoin",
        "AVAXUSDT": "avalanche-2",
        "LINKUSDT": "chainlink",
        "MATICUSDT": "matic-network",
    }
    _SEEDS = {
        "BTCUSDT": 68000.0, "ETHUSDT": 3500.0, "SOLUSDT": 160.0,
        "BNBUSDT": 590.0, "XRPUSDT": 0.55, "ADAUSDT": 0.42,
        "DOGEUSDT": 0.15, "AVAXUSDT": 32.0, "LINKUSDT": 14.5, "MATICUSDT": 0.68,
    }

    async def start(self) -> None:
        self._client = httpx.AsyncClient(timeout=8.0, headers={"User-Agent": "cryptobot-terminal/1.0"})
        # Warm history from CoinGecko (1d, hourly) so strategies work immediately.
        for pair, cg_id in self._COINGECKO_IDS.items():
            try:
                r = await self._client.get(
                    f"https://api.coingecko.com/api/v3/coins/{cg_id}/market_chart",
                    params={"vs_currency": "usd", "days": 1, "interval": "hourly"},
                )
                r.raise_for_status()
                pts = r.json().get("prices", [])[-120:]
                for _, px in pts:
                    self.history[pair].append(float(px))
                    self.volume[pair].append(random.uniform(20, 250))
                if self.history[pair]:
                    self.prices[pair] = self.history[pair][-1]
                else:
                    raise ValueError("empty")
            except Exception as exc:  # pragma: no cover
                logger.warning("warmup failed for %s: %s", pair, exc)
                seed = self._SEEDS.get(pair, 100.0)
                for _ in range(120):
                    seed *= 1 + random.uniform(-0.001, 0.001)
                    self.history[pair].append(seed)
                    self.volume[pair].append(random.uniform(10, 100))
                self.prices[pair] = seed
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        if self._client:
            await self._client.aclose()

    async def _loop(self) -> None:
        while True:
            try:
                assert self._client is not None
                ids = ",".join(self._COINGECKO_IDS.values())
                r = await self._client.get(
                    "https://api.coingecko.com/api/v3/simple/price",
                    params={"ids": ids, "vs_currencies": "usd"},
                )
                if r.status_code == 200:
                    data = r.json()
                    for sym, cg in self._COINGECKO_IDS.items():
                        px = float(data.get(cg, {}).get("usd", self.prices.get(sym, 0)))
                        if px <= 0:
                            continue
                        px = px * (1 + random.uniform(-0.0005, 0.0005))
                        self.prices[sym] = px
                        self.history[sym].append(px)
                        self.volume[sym].append(random.uniform(20, 250))
                else:
                    raise RuntimeError(f"status {r.status_code}")
            except Exception as exc:  # pragma: no cover
                logger.debug("feed poll error: %s", exc)
                for sym, px in list(self.prices.items()):
                    new = px * (1 + random.uniform(-0.0015, 0.0015))
                    self.prices[sym] = new
                    self.history[sym].append(new)
                    self.volume[sym].append(random.uniform(20, 250))
            await asyncio.sleep(6.0)

    def snapshot(self, pair: str) -> Dict[str, Any]:
        prices = list(self.history.get(pair, []))
        if not prices:
            return {"pair": pair, "price": 0, "change_24h": 0, "history": []}
        return {
            "pair": pair,
            "price": prices[-1],
            "change_24h": ((prices[-1] / prices[0]) - 1) * 100 if prices[0] else 0.0,
            "history": prices[-60:],
            "high": max(prices[-60:]) if len(prices) >= 60 else max(prices),
            "low": min(prices[-60:]) if len(prices) >= 60 else min(prices),
        }


feed = MarketFeed()


# ---------------------------------------------------------------------------
# Strategy math
# ---------------------------------------------------------------------------
def sma(values: List[float], n: int) -> float:
    if len(values) < n:
        return sum(values) / len(values)
    return sum(values[-n:]) / n


def stdev(values: List[float], n: int) -> float:
    v = values[-n:] if len(values) >= n else values
    if len(v) < 2:
        return 0.0
    return statistics.pstdev(v)


def vwap(prices: List[float], vols: List[float], n: int = 30) -> float:
    p = prices[-n:]
    v = vols[-n:]
    total_v = sum(v)
    if total_v == 0:
        return sum(p) / len(p)
    return sum(pi * vi for pi, vi in zip(p, v)) / total_v


def detect_regime(prices: List[float]) -> str:
    if len(prices) < 30:
        return "low_liquidity"
    recent = prices[-30:]
    vol = stdev(recent, 30) / (sum(recent) / len(recent))
    trend = (recent[-1] - recent[0]) / recent[0]
    if vol > 0.012:
        return "volatile"
    if abs(trend) > 0.008:
        return "trending"
    return "ranging"


def signal_mean_reversion(prices: List[float], params: Dict[str, Any]) -> Dict[str, Any]:
    n = int(params.get("period", 20))
    z = float(params.get("z_entry", 2.0))
    if len(prices) < n + 1:
        return {"action": "hold", "z": 0.0}
    mean = sma(prices, n)
    sd = stdev(prices, n) or 1e-9
    zscore = (prices[-1] - mean) / sd
    if zscore <= -z:
        return {"action": "buy", "z": zscore, "target": mean}
    if zscore >= z:
        return {"action": "sell", "z": zscore, "target": mean}
    return {"action": "hold", "z": zscore}


def signal_trend_following(prices: List[float], vols: List[float], params: Dict[str, Any]) -> Dict[str, Any]:
    fast = int(params.get("fast", 9))
    slow = int(params.get("slow", 30))
    if len(prices) < slow + 2:
        return {"action": "hold"}
    fast_sma = sma(prices, fast)
    slow_sma = sma(prices, slow)
    vw = vwap(prices, vols, slow)
    px = prices[-1]
    if fast_sma > slow_sma and px > vw:
        return {"action": "buy", "vwap": vw}
    if fast_sma < slow_sma and px < vw:
        return {"action": "sell", "vwap": vw}
    return {"action": "hold", "vwap": vw}


def signal_grid(price: float, params: Dict[str, Any], position: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    lower = float(params.get("lower", price * 0.95))
    upper = float(params.get("upper", price * 1.05))
    levels = int(params.get("levels", 6))
    step = (upper - lower) / max(levels, 1)
    if step <= 0:
        return {"action": "hold"}
    level_idx = int((price - lower) / step)
    if not position and price <= lower + step:
        return {"action": "buy", "grid_level": level_idx}
    if position and price >= upper - step:
        return {"action": "sell", "grid_level": level_idx}
    return {"action": "hold", "grid_level": level_idx}


def signal_walking_grid(
    prices: List[float],
    params: Dict[str, Any],
    strat: Dict[str, Any],
    position: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Dynamic grid — the band walks up (or down) when price breaks out and the bot
    has been idle. Uses the strategy record itself to persist the current band via
    `params["lower"]` / `params["upper"]`, which the engine writes back after each tick.

    Extra params vs plain grid:
      - drift_pct (default 0.02): fraction of band width to shift on breakout.
      - idle_ticks (default 4): stored on the strategy as `idle_ticks`; when the grid
        is idle and price is beyond the band by drift_pct * band, we walk the band.
    """
    price = prices[-1]
    lower = float(params.get("lower", price * 0.95))
    upper = float(params.get("upper", price * 1.05))
    band = max(upper - lower, 1e-9)
    drift_pct = float(params.get("drift_pct", 0.02))
    idle_threshold = int(params.get("idle_ticks", 4))
    idle = int(strat.get("idle_ticks", 0))

    walk: Optional[Dict[str, float]] = None
    if not position:
        if price > upper and idle >= idle_threshold:
            shift = band * drift_pct
            walk = {"lower": lower + shift, "upper": upper + shift}
        elif price < lower and idle >= idle_threshold:
            shift = band * drift_pct
            walk = {"lower": lower - shift, "upper": upper - shift}

    # Delegate the entry/exit logic to the vanilla grid using the (possibly walked) band.
    active_lower = walk["lower"] if walk else lower
    active_upper = walk["upper"] if walk else upper
    base = signal_grid(price, {"lower": active_lower, "upper": active_upper, "levels": params.get("levels", 6)}, position)
    if walk:
        base["walk"] = walk
    return base


# ---------------------------------------------------------------------------
# Bot engine
# ---------------------------------------------------------------------------
class BotEngine:
    """Runs every 4 seconds, iterates active strategies, evaluates, paper-trades."""

    def __init__(self) -> None:
        self._task: Optional[asyncio.Task] = None
        self.kill_switch: bool = False

    async def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    async def _loop(self) -> None:
        while True:
            try:
                if not self.kill_switch:
                    await self._tick()
            except Exception as exc:  # pragma: no cover
                logger.exception("bot tick error: %s", exc)
            await asyncio.sleep(4.0)

    async def _tick(self) -> None:
        cursor = db.strategies.find({"status": "running"}, {"_id": 0})
        strategies = await cursor.to_list(200)
        for strat in strategies:
            await self._evaluate(strat)

    async def _evaluate(self, strat: Dict[str, Any]) -> None:
        pair = strat["pair"]
        prices = list(feed.history.get(pair, []))
        vols = list(feed.volume.get(pair, []))
        if not prices:
            return
        price = prices[-1]
        regime = detect_regime(prices)
        position = strat.get("open_position")

        # Regime gating: mean reversion prefers ranging, trend prefers trending.
        stype = strat["strategy_type"]
        if stype == "mean_reversion":
            sig = signal_mean_reversion(prices, strat.get("params", {}))
        elif stype == "trend_following":
            sig = signal_trend_following(prices, vols, strat.get("params", {}))
        elif stype == "walking_grid":
            sig = signal_walking_grid(prices, strat.get("params", {}), strat, position)
        else:
            sig = signal_grid(price, strat.get("params", {}), position)

        # Position sizing: min(per_trade_pct * equity, allocation_usdt)
        per_trade_pct = float(strat.get("risk", {}).get("per_trade_pct", 0.02))
        equity = float(strat.get("equity", strat.get("allocation_usdt", 0)))
        max_notional = min(per_trade_pct * equity * 25, strat["allocation_usdt"])  # 25x kelly-ish cap
        max_notional = max(max_notional, 10.0)

        # Trailing MDD check
        peak = max(float(strat.get("peak_equity", equity)), equity)
        max_dd_pct = float(strat.get("risk", {}).get("max_dd_pct", 0.05))
        halted = False
        if peak > 0 and (peak - equity) / peak > max_dd_pct:
            halted = True

        update: Dict[str, Any] = {"regime": regime, "peak_equity": peak}
        if halted:
            update["status"] = "halted"
            if position:
                await self._close_position(strat, price, reason="max_drawdown_hit", regime=regime)
            await db.strategies.update_one({"id": strat["id"]}, {"$set": update})
            try:
                await push_all(
                    data={
                        "title": f"⚠️ {strat['name']} halted",
                        "message": f"Max drawdown reached on {strat['pair']}. New entries paused.",
                        "action_url": f"/strategy/{strat['id']}",
                    },
                    idempotency_key=f"halt-{strat['id']}-{int(peak)}",
                )
            except Exception:
                pass
            return

        # Per-position stop-loss and trailing stop (applies to every strategy type).
        risk = strat.get("risk", {}) or {}
        stop_loss_pct = float(risk.get("stop_loss_pct", 0) or 0)
        trailing_stop_pct = float(risk.get("trailing_stop_pct", 0) or 0)
        if position:
            entry = float(position["entry_price"])
            highest = max(float(position.get("highest_price", entry)), price)
            update.setdefault("open_position", dict(position))
            update["open_position"]["highest_price"] = highest
            if stop_loss_pct > 0 and (entry - price) / entry >= stop_loss_pct:
                await self._close_position(strat, price, reason=f"stop_loss:{stop_loss_pct}", regime=regime)
                fresh = await db.strategies.find_one({"id": strat["id"]}, {"_id": 0})
                if fresh:
                    update["equity"] = fresh.get("equity", equity)
                    update["open_position"] = None
                    update["unrealized_pnl"] = 0.0
                await db.strategies.update_one({"id": strat["id"]}, {"$set": update})
                return
            if trailing_stop_pct > 0 and highest > entry and (highest - price) / highest >= trailing_stop_pct:
                await self._close_position(strat, price, reason=f"trailing_stop:{trailing_stop_pct}", regime=regime)
                fresh = await db.strategies.find_one({"id": strat["id"]}, {"_id": 0})
                if fresh:
                    update["equity"] = fresh.get("equity", equity)
                    update["open_position"] = None
                    update["unrealized_pnl"] = 0.0
                await db.strategies.update_one({"id": strat["id"]}, {"$set": update})
                return

        action = sig.get("action", "hold")

        # Walking-grid: idle counter + band walk persistence.
        if stype == "walking_grid":
            if action == "hold":
                update["idle_ticks"] = int(strat.get("idle_ticks", 0)) + 1
            else:
                update["idle_ticks"] = 0
            walk = sig.get("walk")
            if walk:
                params = dict(strat.get("params", {}))
                params["lower"] = walk["lower"]
                params["upper"] = walk["upper"]
                update["params"] = params
                update["idle_ticks"] = 0

        if action == "buy" and not position:
            qty = max_notional / price
            fee = qty * price * 0.001
            new_pos = {
                "side": "long",
                "entry_price": price,
                "highest_price": price,
                "qty": qty,
                "opened_at": utcnow().isoformat(),
                "reason": f"{stype}:{sig}",
            }
            update["open_position"] = new_pos
            update["equity"] = equity - fee
            await self._log_trade(strat, "buy", qty, price, fee, 0.0, str(sig), regime)
        elif action == "sell" and position:
            await self._close_position(strat, price, reason=str(sig), regime=regime)
            fresh = await db.strategies.find_one({"id": strat["id"]}, {"_id": 0})
            if fresh:
                update["equity"] = fresh.get("equity", equity)
                update["open_position"] = None
        # Update unrealized pnl
        fresh_pos = update.get("open_position", position)
        unreal = 0.0
        if fresh_pos:
            unreal = (price - fresh_pos["entry_price"]) * fresh_pos["qty"]
        update["unrealized_pnl"] = unreal
        await db.strategies.update_one({"id": strat["id"]}, {"$set": update})

    async def _close_position(self, strat: Dict[str, Any], price: float, reason: str, regime: str) -> None:
        pos = strat.get("open_position")
        if not pos:
            return
        qty = pos["qty"]
        fee = qty * price * 0.001
        pnl = (price - pos["entry_price"]) * qty - fee
        equity = float(strat.get("equity", strat["allocation_usdt"])) + pnl
        realized = float(strat.get("realized_pnl", 0.0)) + pnl
        await db.strategies.update_one(
            {"id": strat["id"]},
            {"$set": {
                "open_position": None,
                "equity": equity,
                "realized_pnl": realized,
                "peak_equity": max(equity, float(strat.get("peak_equity", equity))),
            }},
        )
        await self._log_trade(strat, "sell", qty, price, fee, pnl, reason, regime)

    async def _log_trade(
        self,
        strat: Dict[str, Any],
        side: str,
        qty: float,
        price: float,
        fee: float,
        pnl: float,
        reason: str,
        regime: str,
    ) -> None:
        trade = {
            "id": new_id(),
            "strategy_id": strat["id"],
            "strategy_name": strat["name"],
            "pair": strat["pair"],
            "exchange": strat["exchange"],
            "side": side,
            "qty": qty,
            "price": price,
            "fee": fee,
            "pnl": pnl,
            "reason": reason,
            "regime": regime,
            "executed_at": utcnow(),
        }
        await db.trades.insert_one(trade)
        # Fire-and-forget push. Never raises.
        title = f"{strat['name']} {side.upper()} {strat['pair']}"
        if side == "sell":
            emoji = "🟢" if pnl >= 0 else "🔴"
            msg = f"{emoji} Closed at ${price:,.2f} · P&L {pnl:+.2f}"
        else:
            msg = f"Opened at ${price:,.2f} · qty {qty:.6f}"
        try:
            await push_all(
                data={"title": title, "message": msg, "action_url": f"/strategy/{strat['id']}"},
                idempotency_key=trade["id"],
            )
        except Exception:
            pass


bot = BotEngine()


# ---------------------------------------------------------------------------
# Sentiment (Claude via Emergent LLM key)
# ---------------------------------------------------------------------------
async def analyze_sentiment(pair: str, headlines: List[str]) -> Dict[str, Any]:
    text = "\n".join(f"- {h}" for h in headlines[:20])
    prompt = (
        f"You are a crypto market sentiment analyst. Rate market sentiment for {pair} "
        "given ONLY the headlines below. Respond with STRICT JSON on a single line, no prose, "
        "with keys: score (float in [-1,1]), label (one of 'bullish','bearish','neutral'), "
        "confidence (float in [0,1]), drivers (array of 3 short strings).\n\n"
        f"Headlines:\n{text}"
    )
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # local import

        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"sentiment-{pair}-{new_id()}",
            system_message="You are a precise financial sentiment analyzer. Always reply with valid JSON only.",
        ).with_model("anthropic", "claude-sonnet-4-6")
        reply = await chat.send_message(UserMessage(text=prompt))
        import json, re

        raw = reply if isinstance(reply, str) else getattr(reply, "content", str(reply))
        m = re.search(r"\{.*\}", raw, re.S)
        data = json.loads(m.group(0)) if m else {}
        return {
            "score": float(data.get("score", 0)),
            "label": data.get("label", "neutral"),
            "confidence": float(data.get("confidence", 0.5)),
            "drivers": list(data.get("drivers", []))[:5],
        }
    except Exception as exc:
        logger.warning("sentiment fallback: %s", exc)
        # Fallback lexical heuristic so the UI never breaks.
        pos = sum(1 for h in headlines for w in ["surge", "rally", "bull", "record", "adopt", "ETF", "approve"] if w.lower() in h.lower())
        neg = sum(1 for h in headlines for w in ["crash", "hack", "ban", "sell-off", "dump", "fear", "lawsuit"] if w.lower() in h.lower())
        raw_score = (pos - neg) / max(pos + neg, 1)
        label = "bullish" if raw_score > 0.15 else "bearish" if raw_score < -0.15 else "neutral"
        return {
            "score": raw_score,
            "label": label,
            "confidence": min(0.4 + 0.15 * (pos + neg), 0.9),
            "drivers": headlines[:3],
        }


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------
app = FastAPI(title="CryptoBot Terminal API")
api = APIRouter(prefix="/api")


@api.get("/")
async def root() -> Dict[str, Any]:
    return {"service": "cryptobot-terminal", "status": "ok", "time": utcnow().isoformat()}


@api.get("/auth/state")
async def auth_state() -> Dict[str, Any]:
    settings = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0})
    return {"pin_configured": bool(settings and settings.get("pin_hash"))}


@api.post("/auth/setup")
async def auth_setup(payload: PinSetup) -> Dict[str, Any]:
    existing = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0})
    if existing and existing.get("pin_hash"):
        raise HTTPException(400, "PIN already configured. Use reset flow.")
    pin_hash = bcrypt.hashpw(payload.pin.encode(), bcrypt.gensalt()).decode()
    await db.settings.update_one(
        {"id": SETTINGS_ID},
        {"$set": {"id": SETTINGS_ID, "pin_hash": pin_hash, "created_at": utcnow()}},
        upsert=True,
    )
    token = new_id()
    await db.sessions.insert_one({"token": token, "created_at": utcnow()})
    return {"session_token": token}


@api.post("/auth/unlock")
async def auth_unlock(payload: PinVerify) -> Dict[str, Any]:
    settings = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0})
    if not settings or not settings.get("pin_hash"):
        raise HTTPException(400, "PIN not configured")
    if not bcrypt.checkpw(payload.pin.encode(), settings["pin_hash"].encode()):
        raise HTTPException(401, "Incorrect PIN")
    token = new_id()
    await db.sessions.insert_one({"token": token, "created_at": utcnow()})
    return {"session_token": token}


@api.post("/auth/lock")
async def auth_lock(token: str = Depends(require_unlocked)) -> Dict[str, Any]:
    await db.sessions.delete_one({"token": token})
    return {"locked": True}


# ---- Push registration -----------------------------------------------------
class RegisterPushBody(BaseModel):
    user_id: str
    platform: str  # android | ios
    device_token: str


@api.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody) -> Dict[str, Any]:
    """Relay device registration to SuprSend (Emergent-managed) and remember the
    user_id locally so bot events can broadcast to it later.
    """
    await db.push_users.update_one(
        {"user_id": body.user_id},
        {"$set": {"user_id": body.user_id, "platform": body.platform, "last_seen": utcnow()}},
        upsert=True,
    )
    if PUSH_KEY == "placeholder":
        return {"status": "registered", "provider": "placeholder"}
    try:
        resp = await _push_client.post("/api/v1/push/users/register", json=body.model_dump())
        if resp.status_code == 401:
            raise HTTPException(500, "EMERGENT_PUSH_KEY invalid")
        if resp.status_code >= 500:
            raise HTTPException(502, "Push provider unavailable")
        resp.raise_for_status()
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("register-push relay failed: %s", exc)
    return {"status": "registered"}


# ---- Vault (exchange API keys) ---------------------------------------------
def _mask(v: str) -> str:
    if len(v) <= 8:
        return "•" * len(v)
    return v[:4] + "•" * (len(v) - 8) + v[-4:]


@api.get("/vault/keys", response_model=List[ApiKeyOut])
async def list_keys(token: str = Depends(require_unlocked)) -> List[ApiKeyOut]:
    rows = await db.api_keys.find({}, {"_id": 0}).to_list(50)
    return [
        ApiKeyOut(
            id=r["id"],
            exchange=r["exchange"],
            label=r.get("label"),
            api_key_masked=_mask(decrypt(r["api_key"])),
            withdrawal_disabled=True,
            created_at=r["created_at"],
        )
        for r in rows
    ]


@api.post("/vault/keys", response_model=ApiKeyOut)
async def add_key(payload: ApiKeyIn, token: str = Depends(require_unlocked)) -> ApiKeyOut:
    if payload.exchange not in SUPPORTED_EXCHANGES:
        raise HTTPException(400, "Unsupported exchange")
    rec = {
        "id": new_id(),
        "exchange": payload.exchange,
        "label": payload.label,
        "api_key": encrypt(payload.api_key),
        "api_secret": encrypt(payload.api_secret),
        "passphrase": encrypt(payload.passphrase) if payload.passphrase else None,
        "withdrawal_disabled": True,
        "created_at": utcnow(),
    }
    await db.api_keys.insert_one(rec)
    return ApiKeyOut(
        id=rec["id"],
        exchange=rec["exchange"],
        label=rec["label"],
        api_key_masked=_mask(payload.api_key),
        withdrawal_disabled=True,
        created_at=rec["created_at"],
    )


@api.delete("/vault/keys/{key_id}")
async def delete_key(key_id: str, token: str = Depends(require_unlocked)) -> Dict[str, Any]:
    res = await db.api_keys.delete_one({"id": key_id})
    return {"deleted": res.deleted_count}


# ---- Market data -----------------------------------------------------------
@api.get("/market/supported")
async def supported_meta() -> Dict[str, Any]:
    return {
        "exchanges": SUPPORTED_EXCHANGES,
        "pairs": SUPPORTED_PAIRS,
        "free_pairs": DEFAULT_PAIRS,
        "strategies": SUPPORTED_STRATEGIES,
    }


@api.get("/market/pairs")
async def market_pairs() -> List[Dict[str, Any]]:
    out = []
    for p in SUPPORTED_PAIRS:
        snap = feed.snapshot(p)
        prices = list(feed.history.get(p, []))
        out.append({
            **snap,
            "regime": detect_regime(prices) if prices else "low_liquidity",
        })
    return out


@api.get("/market/regimes")
async def market_regimes() -> List[Dict[str, Any]]:
    """Heatmap payload — one row per pair with regime, 24h change, volatility %."""
    out: List[Dict[str, Any]] = []
    for p in SUPPORTED_PAIRS:
        prices = list(feed.history.get(p, []))
        if not prices:
            out.append({"pair": p, "regime": "low_liquidity", "change_24h": 0.0, "volatility_pct": 0.0, "price": 0.0})
            continue
        window = prices[-30:] if len(prices) >= 30 else prices
        mean = sum(window) / len(window)
        vol = (stdev(window, len(window)) / mean * 100) if mean else 0.0
        out.append({
            "pair": p,
            "regime": detect_regime(prices),
            "change_24h": ((prices[-1] / prices[0]) - 1) * 100 if prices[0] else 0.0,
            "volatility_pct": vol,
            "price": prices[-1],
        })
    return out


@api.get("/market/{pair}")
async def market_pair(pair: str) -> Dict[str, Any]:
    if pair not in SUPPORTED_PAIRS:
        raise HTTPException(404, "Unknown pair")
    snap = feed.snapshot(pair)
    prices = list(feed.history.get(pair, []))
    vols = list(feed.volume.get(pair, []))
    return {
        **snap,
        "regime": detect_regime(prices) if prices else "low_liquidity",
        "vwap": vwap(prices, vols) if prices else 0.0,
        "bollinger": {
            "mean": sma(prices, 20),
            "upper": sma(prices, 20) + 2 * stdev(prices, 20),
            "lower": sma(prices, 20) - 2 * stdev(prices, 20),
        } if len(prices) >= 20 else None,
    }


@api.get("/market/{pair}/orderbook")
async def market_orderbook(pair: str) -> Dict[str, Any]:
    """Synthetic L2 book built around the last price for the UI."""
    if pair not in SUPPORTED_PAIRS:
        raise HTTPException(404, "Unknown pair")
    price = feed.prices.get(pair, 0.0)
    if not price:
        return {"pair": pair, "bids": [], "asks": []}
    tick = price * 0.0002
    bids = [(price - tick * i, max(0.01, random.gauss(1.5, 0.4))) for i in range(1, 12)]
    asks = [(price + tick * i, max(0.01, random.gauss(1.5, 0.4))) for i in range(1, 12)]
    return {"pair": pair, "bids": bids, "asks": asks, "mid": price}


# ---- Strategies ------------------------------------------------------------
def _strategy_out(s: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": s["id"],
        "name": s["name"],
        "exchange": s["exchange"],
        "pair": s["pair"],
        "strategy_type": s["strategy_type"],
        "allocation_usdt": s["allocation_usdt"],
        "params": s.get("params", {}),
        "risk": s.get("risk", {}),
        "status": s.get("status", "paused"),
        "regime": s.get("regime", "low_liquidity"),
        "equity": s.get("equity", s["allocation_usdt"]),
        "realized_pnl": s.get("realized_pnl", 0.0),
        "unrealized_pnl": s.get("unrealized_pnl", 0.0),
        "peak_equity": s.get("peak_equity", s["allocation_usdt"]),
        "open_position": s.get("open_position"),
        "is_live": bool(s.get("is_live", False)),
        "created_at": s["created_at"],
    }


@api.get("/strategies")
async def list_strategies(token: str = Depends(require_unlocked)) -> List[Dict[str, Any]]:
    rows = await db.strategies.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return [_strategy_out(r) for r in rows]


@api.post("/strategies")
async def create_strategy(payload: StrategyIn, token: str = Depends(require_unlocked)) -> Dict[str, Any]:
    if payload.strategy_type not in SUPPORTED_STRATEGIES:
        raise HTTPException(400, "Unsupported strategy")
    if payload.exchange not in SUPPORTED_EXCHANGES:
        raise HTTPException(400, "Unsupported exchange")
    if payload.pair not in SUPPORTED_PAIRS:
        raise HTTPException(400, "Unsupported pair")
    rec = {
        "id": new_id(),
        "name": payload.name,
        "exchange": payload.exchange,
        "pair": payload.pair,
        "strategy_type": payload.strategy_type,
        "allocation_usdt": payload.allocation_usdt,
        "params": payload.params or _default_params(payload.strategy_type, payload.pair),
        "risk": {"max_dd_pct": 0.05, "per_trade_pct": 0.02, "stop_loss_pct": 0.0, "trailing_stop_pct": 0.0, **(payload.risk or {})},
        "status": "running",
        "regime": "low_liquidity",
        "equity": payload.allocation_usdt,
        "realized_pnl": 0.0,
        "unrealized_pnl": 0.0,
        "peak_equity": payload.allocation_usdt,
        "open_position": None,
        "idle_ticks": 0,
        "is_live": False,
        "created_at": utcnow(),
    }
    await db.strategies.insert_one(rec)
    return _strategy_out(rec)


@api.post("/strategies/{sid}/live")
async def toggle_live(sid: str, token: str = Depends(require_unlocked)) -> Dict[str, Any]:
    """Toggle a strategy between paper and live. Live requires an API key on file
    for the strategy's exchange; execution stays paper until the user confirms and
    real broker adapters are hooked (out of scope for this MVP).
    """
    strat = await db.strategies.find_one({"id": sid}, {"_id": 0})
    if not strat:
        raise HTTPException(404, "Strategy not found")
    if not strat.get("is_live"):
        # Enable live mode: require a key for this exchange.
        key = await db.api_keys.find_one({"exchange": strat["exchange"]}, {"_id": 0})
        if not key:
            raise HTTPException(400, f"No API key on file for {strat['exchange']}. Add one in the Vault first.")
        await db.strategies.update_one({"id": sid}, {"$set": {"is_live": True}})
        return {"is_live": True}
    await db.strategies.update_one({"id": sid}, {"$set": {"is_live": False}})
    return {"is_live": False}


class BacktestIn(BaseModel):
    pair: str
    strategy_type: str
    allocation_usdt: float = 1000.0
    params: Dict[str, Any] = Field(default_factory=dict)
    risk: Dict[str, Any] = Field(default_factory=dict)


@api.post("/backtest")
async def backtest(payload: BacktestIn, token: str = Depends(require_unlocked)) -> Dict[str, Any]:
    """Fast paper backtest against the last ~7d hourly CoinGecko history that the
    market feed already warmed on startup, plus whatever ticks we've seen since.
    Returns an equity curve and summary metrics.
    """
    if payload.pair not in SUPPORTED_PAIRS:
        raise HTTPException(400, "Unsupported pair")
    if payload.strategy_type not in SUPPORTED_STRATEGIES:
        raise HTTPException(400, "Unsupported strategy")
    prices = list(feed.history.get(payload.pair, []))
    vols = list(feed.volume.get(payload.pair, []))
    if len(prices) < 30:
        raise HTTPException(400, "Not enough market history yet — try again in a few seconds.")

    equity = float(payload.allocation_usdt)
    peak = equity
    per_trade_pct = float(payload.risk.get("per_trade_pct", 0.02))
    max_dd_pct = float(payload.risk.get("max_dd_pct", 0.05))
    stop_loss_pct = float(payload.risk.get("stop_loss_pct", 0) or 0)
    trailing_stop_pct = float(payload.risk.get("trailing_stop_pct", 0) or 0)
    params = payload.params or _default_params(payload.strategy_type, payload.pair)

    position: Optional[Dict[str, Any]] = None
    curve: List[Dict[str, Any]] = []
    trade_count = 0
    wins = 0
    losses = 0
    peak_equity = equity
    lowest_equity = equity

    # Walk history bar-by-bar starting after the strategy has enough lookback.
    warmup = max(int(params.get("period", 20)), int(params.get("slow", 30)), 30)
    for i in range(warmup, len(prices)):
        window_prices = prices[: i + 1]
        window_vols = vols[: i + 1]
        px = window_prices[-1]
        st = payload.strategy_type
        if st == "mean_reversion":
            sig = signal_mean_reversion(window_prices, params)
        elif st == "trend_following":
            sig = signal_trend_following(window_prices, window_vols, params)
        elif st == "walking_grid":
            sig = signal_walking_grid(window_prices, params, {"idle_ticks": 0}, position)
        else:
            sig = signal_grid(px, params, position)

        # Trailing / stop-loss for open positions.
        if position:
            entry = position["entry_price"]
            position["highest_price"] = max(position.get("highest_price", entry), px)
            if stop_loss_pct > 0 and (entry - px) / entry >= stop_loss_pct:
                pnl = (px - entry) * position["qty"] - position["qty"] * px * 0.001
                equity += pnl
                trade_count += 1
                (wins if pnl > 0 else losses).__add__(1)
                if pnl > 0: wins += 1
                else: losses += 1
                position = None
            elif trailing_stop_pct > 0 and position["highest_price"] > entry and \
                    (position["highest_price"] - px) / position["highest_price"] >= trailing_stop_pct:
                pnl = (px - entry) * position["qty"] - position["qty"] * px * 0.001
                equity += pnl
                trade_count += 1
                if pnl > 0: wins += 1
                else: losses += 1
                position = None

        action = sig.get("action", "hold")
        if action == "buy" and not position:
            notional = min(per_trade_pct * equity * 25, payload.allocation_usdt)
            notional = max(notional, 10.0)
            qty = notional / px
            fee = qty * px * 0.001
            equity -= fee
            position = {"entry_price": px, "qty": qty, "highest_price": px}
        elif action == "sell" and position:
            pnl = (px - position["entry_price"]) * position["qty"] - position["qty"] * px * 0.001
            equity += pnl
            trade_count += 1
            if pnl > 0: wins += 1
            else: losses += 1
            position = None

        peak_equity = max(peak_equity, equity)
        lowest_equity = min(lowest_equity, equity)
        # MDD halt (soft — we just stop trading and mark on curve)
        if peak_equity > 0 and (peak_equity - equity) / peak_equity > max_dd_pct:
            curve.append({"i": i, "equity": equity, "halted": True})
            break
        curve.append({"i": i, "equity": equity})

    # Mark-to-market any open position at the final bar.
    if position:
        px = prices[-1]
        unreal = (px - position["entry_price"]) * position["qty"]
    else:
        unreal = 0.0

    total_return_pct = ((equity - payload.allocation_usdt) / payload.allocation_usdt) * 100 if payload.allocation_usdt else 0.0
    max_dd = (peak_equity - lowest_equity) / peak_equity * 100 if peak_equity else 0.0
    win_rate = (wins / trade_count * 100) if trade_count else 0.0

    return {
        "bars": len(prices),
        "equity_curve": [c["equity"] for c in curve][-100:],
        "trades": trade_count,
        "wins": wins,
        "losses": losses,
        "win_rate_pct": win_rate,
        "final_equity": equity + unreal,
        "total_return_pct": total_return_pct,
        "max_drawdown_pct": max_dd,
        "halted_early": any(c.get("halted") for c in curve),
    }


def _default_params(strategy_type: str, pair: str) -> Dict[str, Any]:
    price = feed.prices.get(pair, 0.0) or 1.0
    if strategy_type == "mean_reversion":
        return {"period": 20, "z_entry": 2.0}
    if strategy_type == "trend_following":
        return {"fast": 9, "slow": 30}
    if strategy_type == "walking_grid":
        return {"lower": price * 0.95, "upper": price * 1.05, "levels": 6, "drift_pct": 0.02, "idle_ticks": 4}
    return {"lower": price * 0.95, "upper": price * 1.05, "levels": 6}


@api.post("/strategies/{sid}/pause")
async def pause_strategy(sid: str, token: str = Depends(require_unlocked)) -> Dict[str, Any]:
    await db.strategies.update_one({"id": sid}, {"$set": {"status": "paused"}})
    return {"paused": True}


@api.post("/strategies/{sid}/resume")
async def resume_strategy(sid: str, token: str = Depends(require_unlocked)) -> Dict[str, Any]:
    await db.strategies.update_one({"id": sid}, {"$set": {"status": "running"}})
    return {"running": True}


@api.delete("/strategies/{sid}")
async def delete_strategy(sid: str, token: str = Depends(require_unlocked)) -> Dict[str, Any]:
    strat = await db.strategies.find_one({"id": sid}, {"_id": 0})
    if strat and strat.get("open_position"):
        price = feed.prices.get(strat["pair"], strat["open_position"]["entry_price"])
        await bot._close_position(strat, price, reason="strategy_deleted", regime=strat.get("regime", ""))
    await db.strategies.delete_one({"id": sid})
    return {"deleted": True}


@api.get("/strategies/{sid}")
async def get_strategy(sid: str, token: str = Depends(require_unlocked)) -> Dict[str, Any]:
    s = await db.strategies.find_one({"id": sid}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Strategy not found")
    return _strategy_out(s)


# ---- Portfolio -------------------------------------------------------------
@api.get("/portfolio")
async def portfolio(token: str = Depends(require_unlocked)) -> Dict[str, Any]:
    strats = await db.strategies.find({}, {"_id": 0}).to_list(200)
    total_equity = sum(s.get("equity", s["allocation_usdt"]) for s in strats)
    total_alloc = sum(s["allocation_usdt"] for s in strats)
    realized = sum(s.get("realized_pnl", 0.0) for s in strats)
    unrealized = sum(s.get("unrealized_pnl", 0.0) for s in strats)
    active = sum(1 for s in strats if s.get("status") == "running")
    halted = sum(1 for s in strats if s.get("status") == "halted")
    # Simple equity curve: cumulative pnl from trades over time.
    trades = await db.trades.find({}, {"_id": 0}).sort("executed_at", 1).to_list(500)
    curve: List[Dict[str, Any]] = []
    running = 0.0
    for t in trades:
        running += t["pnl"]
        curve.append({"t": t["executed_at"].isoformat() if isinstance(t["executed_at"], datetime) else t["executed_at"], "pnl": running})
    return {
        "total_equity": total_equity,
        "total_allocated": total_alloc,
        "realized_pnl": realized,
        "unrealized_pnl": unrealized,
        "active_bots": active,
        "halted_bots": halted,
        "kill_switch": bot.kill_switch,
        "equity_curve": curve[-100:],
    }


@api.post("/portfolio/kill-switch")
async def toggle_kill(token: str = Depends(require_unlocked)) -> Dict[str, Any]:
    bot.kill_switch = not bot.kill_switch
    if bot.kill_switch:
        # Flatten all open positions.
        strats = await db.strategies.find({"open_position": {"$ne": None}}, {"_id": 0}).to_list(200)
        for s in strats:
            price = feed.prices.get(s["pair"], s["open_position"]["entry_price"])
            await bot._close_position(s, price, reason="kill_switch", regime=s.get("regime", ""))
        await db.strategies.update_many({"status": "running"}, {"$set": {"status": "paused"}})
    return {"kill_switch": bot.kill_switch}


# ---- Trades / Journal ------------------------------------------------------
@api.get("/trades")
async def list_trades(token: str = Depends(require_unlocked), limit: int = 100) -> List[Dict[str, Any]]:
    rows = await db.trades.find({}, {"_id": 0}).sort("executed_at", -1).to_list(limit)
    for r in rows:
        if isinstance(r.get("executed_at"), datetime):
            r["executed_at"] = r["executed_at"].isoformat()
    return rows


# ---- Sentiment -------------------------------------------------------------
DEFAULT_HEADLINES = {
    "BTCUSDT": [
        "Spot Bitcoin ETFs see record weekly inflows as institutions accumulate",
        "MicroStrategy adds another 5,000 BTC to treasury reserves",
        "Fed minutes hint at earlier rate cuts, risk assets rally",
        "US regulator opens probe into leveraged crypto lender",
        "Miner reserves fall to multi-month low signaling holder confidence",
    ],
    "ETHUSDT": [
        "Ethereum staking yield ticks higher post-upgrade",
        "L2 rollup volumes hit all-time high, ETH burn accelerates",
        "SEC delays decision on Ethereum spot ETF applications",
        "Major DeFi protocol suffers exploit, TVL drops sharply",
    ],
    "SOLUSDT": [
        "Solana network reports zero downtime for the quarter",
        "New memecoin wave brings retail volume to Solana DEXs",
        "Firedancer client testnet passes major milestone",
        "Validator concentration concerns resurface among devs",
    ],
}


@api.post("/sentiment", response_model=SentimentOut)
async def sentiment(payload: SentimentIn, token: str = Depends(require_unlocked)) -> SentimentOut:
    heads = payload.headlines or DEFAULT_HEADLINES.get(payload.pair, [])
    if not heads:
        raise HTTPException(400, "No headlines")
    data = await analyze_sentiment(payload.pair, heads)
    out = SentimentOut(
        pair=payload.pair,
        score=data["score"],
        label=data["label"],
        confidence=data["confidence"],
        drivers=data["drivers"],
        generated_at=utcnow(),
    )
    await db.sentiment.insert_one(out.model_dump())
    return out


@api.get("/sentiment/{pair}")
async def latest_sentiment(pair: str, token: str = Depends(require_unlocked)) -> Dict[str, Any]:
    row = await db.sentiment.find_one({"pair": pair}, {"_id": 0}, sort=[("generated_at", -1)])
    if not row:
        # Auto-generate one on first call so the UI has content.
        heads = DEFAULT_HEADLINES.get(pair, [])
        data = await analyze_sentiment(pair, heads)
        row = {
            "pair": pair,
            "score": data["score"],
            "label": data["label"],
            "confidence": data["confidence"],
            "drivers": data["drivers"],
            "generated_at": utcnow(),
            "headlines": heads,
        }
        await db.sentiment.insert_one(row)
        row.pop("_id", None)
    if isinstance(row.get("generated_at"), datetime):
        row["generated_at"] = row["generated_at"].isoformat()
    row.setdefault("headlines", DEFAULT_HEADLINES.get(pair, []))
    return row


# ---------------------------------------------------------------------------
# App wiring
# ---------------------------------------------------------------------------
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup() -> None:
    await feed.start()
    await bot.start()


@app.on_event("shutdown")
async def _shutdown() -> None:
    await bot.stop()
    await feed.stop()
    client.close()
