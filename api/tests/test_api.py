"""API 端到端测试（TestClient）。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_solve_ok():
    payload = {
        "points": ["r", "a", "b", "c", "d"],
        "root": "r",
        "channels": [
            {"id": "e1", "from": "r", "to": "a", "cost": 5},
            {"id": "e2", "from": "a", "to": "b", "cost": 1},
            {"id": "e3", "from": "b", "to": "a", "cost": 1},
            {"id": "e4", "from": "b", "to": "c", "cost": 1},
            {"id": "e5", "from": "c", "to": "a", "cost": 1},
            {"id": "e6", "from": "c", "to": "d", "cost": 1},
        ],
    }
    r = client.post("/api/solve", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["total_cost"] == 8
    assert body["canonical_ids"] == ["e1", "e2", "e4", "e6"]
    assert len(body["tree"]) == 4
    assert body["record"]["contractions"] == 2
    assert len(body["record"]["expansions"]) == 2


def test_solve_unsolvable():
    payload = {
        "points": ["r", "a", "z"],
        "root": "r",
        "channels": [{"id": "u1", "from": "r", "to": "a", "cost": 1}],
    }
    r = client.post("/api/solve", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "unsolvable"
    assert body["unreachable"] == ["z"]
    assert body["reason"]


def test_invalid_self_loop():
    payload = {
        "points": ["r", "a"],
        "root": "r",
        "channels": [{"id": "c1", "from": "a", "to": "a", "cost": 1}],
    }
    r = client.post("/api/solve", json=payload)
    assert r.status_code == 422
    body = r.json()
    assert body["status"] == "invalid"
    assert any("自环" in e for e in body["errors"])


def test_invalid_schema():
    r = client.post("/api/solve", json={"points": ["r"], "root": "r"})
    assert r.status_code == 422
    assert r.json()["status"] == "invalid"


def test_negative_cost_rejected():
    payload = {
        "points": ["r", "a"],
        "root": "r",
        "channels": [{"id": "c1", "from": "r", "to": "a", "cost": -2}],
    }
    r = client.post("/api/solve", json=payload)
    assert r.status_code == 422
    assert r.json()["status"] == "invalid"


def test_costs_beyond_safe_integer_preserve_precision():
    """超过 JS Number.MAX_SAFE_INTEGER（2^53−1）的代价必须按原值参与比较与输出。"""
    big_plus_one = 9007199254740993  # 2^53 + 1
    big = 9007199254740992  # 2^53
    # 以原始 JSON 文本发送，模拟页面提交的线路内容（两个不同的完整十进制整数）
    raw_req = (
        '{"points": ["r", "a"], "root": "r", "channels": ['
        '{"id": "e1", "from": "r", "to": "a", "cost": 9007199254740993}, '
        '{"id": "e2", "from": "r", "to": "a", "cost": 9007199254740992}]}'
    )
    r = client.post("/api/solve", content=raw_req, headers={"Content-Type": "application/json"})
    assert r.status_code == 200
    # 响应文本上就是完整十进制，而非 double 舍入 / 指数记数
    raw = r.text
    assert "9007199254740992" in raw
    assert "9.007199254740992e" not in raw.lower()
    body = r.json()
    assert body["status"] == "ok"
    # 相邻大整数保持大小关系：更便宜的 e2 入选，而非被 double 舍入同价后按标识选 e1
    assert big_plus_one > big
    assert body["canonical_ids"] == ["e2"]
    assert body["total_cost"] == big
    assert body["tree"] == [{"id": "e2", "from": "r", "to": "a", "cost": big}]

