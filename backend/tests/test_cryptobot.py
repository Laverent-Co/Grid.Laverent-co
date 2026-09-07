"""CryptoBot Terminal backend tests."""
import os
import time
import pytest
import requests

BASE_URL = "https://secure-algo-bot.preview.emergentagent.com"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(api):
    r = api.post(f"{BASE_URL}/api/auth/unlock", json={"pin": "1234"}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json().get("session_token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"X-Session-Token": token, "Content-Type": "application/json"}


# --------- Health & Auth ---------
class TestHealthAuth:
    def test_root(self, api):
        r = api.get(f"{BASE_URL}/api/", timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j.get("status") == "ok"
        assert "_id" not in j

    def test_auth_state(self, api):
        r = api.get(f"{BASE_URL}/api/auth/state", timeout=15)
        assert r.status_code == 200
        assert r.json().get("pin_configured") is True

    def test_unlock_wrong_pin(self, api):
        r = api.post(f"{BASE_URL}/api/auth/unlock", json={"pin": "9999"}, timeout=15)
        assert r.status_code == 401

    def test_unlock_correct_pin(self, api):
        r = api.post(f"{BASE_URL}/api/auth/unlock", json={"pin": "1234"}, timeout=15)
        assert r.status_code == 200
        assert r.json().get("session_token")


# --------- Auth enforcement ---------
class TestAuthEnforcement:
    @pytest.mark.parametrize("path,method", [
        ("/api/strategies", "GET"),
        ("/api/portfolio", "GET"),
        ("/api/vault/keys", "GET"),
        ("/api/trades", "GET"),
        ("/api/sentiment/BTCUSDT", "GET"),
        ("/api/portfolio/kill-switch", "POST"),
    ])
    def test_requires_session(self, api, path, method):
        r = api.request(method, f"{BASE_URL}{path}", timeout=15)
        assert r.status_code == 401, f"{path} returned {r.status_code}"


# --------- Market ---------
class TestMarket:
    def test_market_pairs(self, api):
        r = api.get(f"{BASE_URL}/api/market/pairs", timeout=15)
        assert r.status_code == 200
        data = r.json()
        pairs = {d["pair"] for d in data}
        assert {"BTCUSDT", "ETHUSDT", "SOLUSDT"}.issubset(pairs)
        for d in data:
            assert "price" in d and "history" in d and "regime" in d
            assert "_id" not in d

    def test_market_btc(self, api):
        r = api.get(f"{BASE_URL}/api/market/BTCUSDT", timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "vwap" in j
        assert "bollinger" in j
        assert "regime" in j

    def test_market_orderbook(self, api):
        r = api.get(f"{BASE_URL}/api/market/BTCUSDT/orderbook", timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "bids" in j and "asks" in j and "mid" in j
        assert len(j["bids"]) > 0
        assert len(j["asks"]) > 0

    def test_market_unknown_pair(self, api):
        r = api.get(f"{BASE_URL}/api/market/FOOUSDT", timeout=15)
        assert r.status_code == 404


# --------- Vault ---------
class TestVault:
    created_ids = []

    def test_add_and_list_keys(self, api, auth_headers):
        for ex in ["binance", "coinbase", "kraken"]:
            payload = {
                "exchange": ex,
                "label": f"TEST_{ex}",
                "api_key": f"TEST_APIKEY_{ex}_1234567890",
                "api_secret": f"TEST_SECRET_{ex}_ABCDEFGHIJ",
            }
            r = requests.post(f"{BASE_URL}/api/vault/keys", json=payload, headers=auth_headers, timeout=15)
            assert r.status_code == 200, r.text
            j = r.json()
            assert j["exchange"] == ex
            assert "•" in j["api_key_masked"]
            assert "_id" not in j
            TestVault.created_ids.append(j["id"])

        r = requests.get(f"{BASE_URL}/api/vault/keys", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        keys = r.json()
        exchanges = {k["exchange"] for k in keys}
        assert {"binance", "coinbase", "kraken"}.issubset(exchanges)
        for k in keys:
            assert "_id" not in k
            assert "•" in k["api_key_masked"]

    def test_delete_keys(self, api, auth_headers):
        for kid in TestVault.created_ids:
            r = requests.delete(f"{BASE_URL}/api/vault/keys/{kid}", headers=auth_headers, timeout=15)
            assert r.status_code == 200
            assert r.json().get("deleted") == 1


# --------- Strategies ---------
class TestStrategies:
    created = {}

    def test_create_mean_reversion(self, auth_headers):
        payload = {
            "name": "TEST_MR_BTC",
            "exchange": "binance",
            "pair": "BTCUSDT",
            "strategy_type": "mean_reversion",
            "allocation_usdt": 1000,
        }
        r = requests.post(f"{BASE_URL}/api/strategies", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["status"] == "running"
        assert j["strategy_type"] == "mean_reversion"
        assert "_id" not in j
        TestStrategies.created["mr"] = j["id"]

    def test_create_trend_following(self, auth_headers):
        payload = {
            "name": "TEST_TF_ETH",
            "exchange": "coinbase",
            "pair": "ETHUSDT",
            "strategy_type": "trend_following",
            "allocation_usdt": 500,
        }
        r = requests.post(f"{BASE_URL}/api/strategies", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        TestStrategies.created["tf"] = r.json()["id"]

    def test_create_grid(self, auth_headers):
        payload = {
            "name": "TEST_GRID_SOL",
            "exchange": "kraken",
            "pair": "SOLUSDT",
            "strategy_type": "grid",
            "allocation_usdt": 300,
        }
        r = requests.post(f"{BASE_URL}/api/strategies", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        TestStrategies.created["grid"] = r.json()["id"]

    def test_list_strategies(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/strategies", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        items = r.json()
        ids = {i["id"] for i in items}
        for sid in TestStrategies.created.values():
            assert sid in ids

    def test_pause_resume(self, auth_headers):
        sid = TestStrategies.created["mr"]
        r = requests.post(f"{BASE_URL}/api/strategies/{sid}/pause", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert r.json().get("paused") is True
        # verify via GET
        g = requests.get(f"{BASE_URL}/api/strategies/{sid}", headers=auth_headers, timeout=15)
        assert g.status_code == 200
        assert g.json()["status"] == "paused"

        r = requests.post(f"{BASE_URL}/api/strategies/{sid}/resume", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert r.json().get("running") is True
        g = requests.get(f"{BASE_URL}/api/strategies/{sid}", headers=auth_headers, timeout=15)
        assert g.json()["status"] == "running"

    def test_invalid_strategy_type(self, auth_headers):
        payload = {
            "name": "TEST_BAD",
            "exchange": "binance",
            "pair": "BTCUSDT",
            "strategy_type": "arbitrage",
            "allocation_usdt": 100,
        }
        r = requests.post(f"{BASE_URL}/api/strategies", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 400


# --------- Portfolio ---------
class TestPortfolio:
    def test_portfolio(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/portfolio", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        j = r.json()
        for k in ["total_equity", "active_bots", "kill_switch", "realized_pnl", "unrealized_pnl", "equity_curve"]:
            assert k in j
        assert isinstance(j["kill_switch"], bool)

    def test_kill_switch_toggle(self, auth_headers):
        r1 = requests.get(f"{BASE_URL}/api/portfolio", headers=auth_headers, timeout=15)
        before = r1.json()["kill_switch"]
        r = requests.post(f"{BASE_URL}/api/portfolio/kill-switch", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        after = r.json()["kill_switch"]
        assert after != before
        # toggle back
        r = requests.post(f"{BASE_URL}/api/portfolio/kill-switch", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["kill_switch"] == before


# --------- Sentiment ---------
class TestSentiment:
    def test_sentiment_btc(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/sentiment/BTCUSDT", headers=auth_headers, timeout=90)
        assert r.status_code == 200, r.text
        j = r.json()
        assert -1 <= j["score"] <= 1
        assert j["label"] in ["bullish", "bearish", "neutral"]
        assert 0 <= j["confidence"] <= 1
        assert isinstance(j["drivers"], list)
        assert "_id" not in j


# --------- Trades ---------
class TestTrades:
    def test_trades_list(self, auth_headers):
        # Wait for bot engine to possibly emit
        time.sleep(10)
        r = requests.get(f"{BASE_URL}/api/trades", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        for t in rows:
            assert "_id" not in t


# --------- Cleanup: delete test strategies ---------
class TestZZCleanup:
    def test_cleanup_strategies(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/strategies", headers=auth_headers, timeout=15)
        for s in r.json():
            if s["name"].startswith("TEST_"):
                requests.delete(f"{BASE_URL}/api/strategies/{s['id']}", headers=auth_headers, timeout=15)
