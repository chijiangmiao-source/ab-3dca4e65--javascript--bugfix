"""verify 一次性服务：对真实 API 与经 Web 反代的同一请求做样例核对 + HTTP 冒烟。

样例覆盖：嵌套环收缩、平行通道、同优规范树字典序、不可达点、
超过 2^53-1 的相邻大整数全程保精度（含页面真实模块的录入/提交/展示管线）；
另含输入错误（自环 / 结构非法）核对。全部断言通过则进程以 0 退出，
任一失败立即以非零码退出。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

# 复用后端的记录复算逻辑，从“独立消费者”视角核对可复算记录
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, "/srv/api")
sys.path.insert(0, os.path.join(_HERE, "..", "api"))
from app.arborescence import Channel, replay_record  # noqa: E402

API = os.environ.get("API_BASE", "http://api:8000")
WEB = os.environ.get("WEB_BASE", "http://web")
NODE = os.environ.get("NODE_BIN", "node")

FAILURES: list[str] = []


def http(method: str, url: str, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def http_raw(method: str, url: str, raw_body: str):
    """直接发送已序列化的请求体原文（用于页面管线产出的 JSON，不经任何重序列化）。"""
    req = urllib.request.Request(
        url, data=raw_body.encode(), method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def run_node_pipeline(mode: str, stdin_text: str) -> str | None:
    """调用页面真实模块（verify/page_pipeline.mjs），返回其 stdout；失败记为 FAILURE。"""
    proc = subprocess.run(
        [NODE, os.path.join(_HERE, "page_pipeline.mjs"), mode],
        input=stdin_text, capture_output=True, text=True, timeout=30,
    )
    if proc.returncode != 0:
        FAILURES.append(f"页面管线 {mode} 执行失败：{proc.stderr.strip()}")
        return None
    return proc.stdout



def wait_for(url: str, label: str, timeout: float = 60.0) -> bool:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as resp:
                if resp.status == 200:
                    return True
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1)
    FAILURES.append(f"{label} 在 {timeout}s 内未就绪: {last}")
    return False


def check(cond: bool, msg: str) -> None:
    mark = "PASS" if cond else "FAIL"
    print(f"  [{mark}] {msg}")
    if not cond:
        FAILURES.append(msg)


def channels_of(payload: dict) -> list[Channel]:
    return [
        Channel(id=c["id"], u=c["from"], v=c["to"], cost=c["cost"])
        for c in payload["channels"]
    ]


SCENARIOS = {
    "nested": {
        "payload": {
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
        },
        "expect_ids": ["e1", "e2", "e4", "e6"],
        "expect_cost": 8,
        "expect_contractions": 2,
    },
    "parallel": {
        "payload": {
            "points": ["r", "x", "y"],
            "root": "r",
            "channels": [
                {"id": "p1", "from": "r", "to": "x", "cost": 3},
                {"id": "p2", "from": "r", "to": "x", "cost": 1},
                {"id": "p3", "from": "x", "to": "y", "cost": 2},
                {"id": "p4", "from": "r", "to": "y", "cost": 9},
                {"id": "p5", "from": "y", "to": "x", "cost": 4},
            ],
        },
        "expect_ids": ["p2", "p3"],
        "expect_cost": 3,
        "expect_contractions": 0,
    },
    "canonical": {
        "payload": {
            "points": ["r", "b", "c", "d"],
            "root": "r",
            "channels": [
                {"id": "k1", "from": "r", "to": "b", "cost": 1},
                {"id": "k2", "from": "b", "to": "c", "cost": 1},
                {"id": "k3", "from": "r", "to": "c", "cost": 1},
                {"id": "k4", "from": "c", "to": "d", "cost": 1},
                {"id": "k5", "from": "r", "to": "d", "cost": 1},
            ],
        },
        "expect_ids": ["k1", "k2", "k4"],
        "expect_cost": 3,
        "expect_contractions": 0,
    },
    "unreachable": {
        "payload": {
            "points": ["r", "a", "b", "z"],
            "root": "r",
            "channels": [
                {"id": "u1", "from": "r", "to": "a", "cost": 1},
                {"id": "u2", "from": "a", "to": "b", "cost": 1},
                {"id": "u3", "from": "z", "to": "a", "cost": 1},
            ],
        },
        "expect_unreachable": ["z"],
    },
}


def verify_ok_scenario(name: str, sc: dict) -> None:
    print(f"- 样例 {name}")
    st_api, body_api = http("POST", f"{API}/api/solve", sc["payload"])
    st_web, body_web = http("POST", f"{WEB}/api/solve", sc["payload"])
    check(st_api == 200 and body_api.get("status") == "ok", "API 直连返回 200/ok")
    check(st_web == 200 and body_web.get("status") == "ok", "经页面同源反代返回 200/ok")
    check(body_api == body_web, "页面反代结果与 API 直连完全一致")
    if body_api.get("status") != "ok":
        return
    check(body_api["total_cost"] == sc["expect_cost"],
          f"总代价 == {sc['expect_cost']}（实际 {body_api['total_cost']}）")
    check(body_api["canonical_ids"] == sc["expect_ids"],
          f"规范树标识序列 == {sc['expect_ids']}（实际 {body_api['canonical_ids']}）")
    check(body_api["record"]["contractions"] == sc["expect_contractions"],
          f"环收缩次数 == {sc['expect_contractions']}")
    replayed = replay_record(
        sc["payload"]["points"], sc["payload"]["root"],
        channels_of(sc["payload"]), body_api["record"],
    )
    check(replayed == body_api["canonical_ids"], "收缩/展开记录独立复算得到同一规范树")
    cost_sum = sum(
        c["cost"] for c in body_api["tree"] if c["id"] in set(body_api["canonical_ids"])
    )
    check(cost_sum == body_api["total_cost"], "逐边代价之和等于总代价")


def verify_unreachable_scenario() -> None:
    print("- 样例 unreachable（不可达点）")
    sc = SCENARIOS["unreachable"]
    st_api, body_api = http("POST", f"{API}/api/solve", sc["payload"])
    st_web, body_web = http("POST", f"{WEB}/api/solve", sc["payload"])
    check(st_api == 200 and body_api["status"] == "unsolvable", "API 直连报告无解")
    check(body_web == body_api, "页面反代同样报告无解")
    check(body_api["unreachable"] == sc["expect_unreachable"],
          f"不可达点 == {sc['expect_unreachable']}（实际 {body_api['unreachable']}）")
    check(bool(body_api.get("reason")), "附带明确原因说明")


def verify_big_integer_boundary() -> None:
    """大整数（>2^53-1）边界：页面录入的两个相邻代价必须全程保精度并选出更便宜的 e2。"""
    print("- 样例 bigint-boundary（超过安全整数范围的相邻非负整数）")
    E1_COST = 9007199254740993  # 2^53+1
    E2_COST = 9007199254740992  # 2^53
    form_spec = {
        "pointsText": "r a",
        "root": "r",
        "channelsText": (
            "# 两条 r -> a 平行通道；e1 比 e2 贵 1，但二者都超过 JS 安全整数范围\n"
            f"e1, r, a, {E1_COST}\n"
            f"e2, r, a, {E2_COST}\n"
        ),
    }
    # 1) 用页面真实模块完成「文本录入 → 解析/校验 → 请求体序列化」
    raw_request = run_node_pipeline("request", json.dumps(form_spec))
    if raw_request is None:
        return
    page_req = json.loads(raw_request)  # Python 整数任意精度，可逐位读回
    by_id = {c["id"]: c["cost"] for c in page_req["channels"]}
    check(by_id.get("e1") == E1_COST, f"页面请求中 e1 代价逐位为 {E1_COST}（实际 {by_id.get('e1')}）")
    check(by_id.get("e2") == E2_COST, f"页面请求中 e2 代价逐位为 {E2_COST}（实际 {by_id.get('e2')}）")
    check(by_id["e1"] != by_id["e2"], "两个相邻大整数在页面请求中未被合并为同值")
    check(by_id["e1"] > by_id["e2"], "两个相邻大整数保持原有大小关系（e1 > e2）")
    check(str(E1_COST) in raw_request and str(E2_COST) in raw_request,
          "请求体原文逐位包含两个完整十进制整数")

    # 2) 页面形成的请求体原文（不再经任何重序列化）打真实 API 与经页面同源反代
    st_api, raw_api = http_raw("POST", f"{API}/api/solve", raw_request)
    st_web, raw_web = http_raw("POST", f"{WEB}/api/solve", raw_request)
    check(st_api == 200, f"页面请求直连 API 返回 200（实际 {st_api}）")
    check(st_web == 200, f"页面请求经同源反代返回 200（实际 {st_web}）")
    page_resp_api = json.loads(raw_api)
    page_resp_web = json.loads(raw_web)

    # 3) 精确整数直接请求真实 API 的基准结果（Python int 逐位构造）
    direct_payload = {
        "points": ["r", "a"],
        "root": "r",
        "channels": [
            {"id": "e1", "from": "r", "to": "a", "cost": E1_COST},
            {"id": "e2", "from": "r", "to": "a", "cost": E2_COST},
        ],
    }
    st_dir, direct_resp = http("POST", f"{API}/api/solve", direct_payload)
    check(st_dir == 200 and direct_resp.get("status") == "ok", "精确整数直连 API 返回 200/ok")

    if page_resp_api.get("status") != "ok" or direct_resp.get("status") != "ok":
        return
    check(page_resp_api == direct_resp, "页面输入形成的请求与精确整数直连 API 结果完全一致")
    check(page_resp_web == direct_resp, "页面请求经同源反代与精确整数直连 API 结果完全一致")
    check(page_resp_api["canonical_ids"] == ["e2"],
          f"规范树选择实际更便宜的 e2（实际 {page_resp_api['canonical_ids']}）")
    check(page_resp_api["total_cost"] == E2_COST,
          f"总代价 == {E2_COST}（实际 {page_resp_api['total_cost']}）")
    e2_edge = next(c for c in page_resp_api["tree"] if c["id"] == "e2")
    check(e2_edge["cost"] == E2_COST, f"逐边代价 e2 == {E2_COST}（实际 {e2_edge['cost']}）")
    check(str(E2_COST) in raw_api, "响应原文逐位包含完整十进制总/逐边代价")

    # 4) 响应原文交回页面真实模块做结果处理与格式化
    processed_text = run_node_pipeline("process", raw_api)
    if processed_text is None:
        return
    processed = json.loads(processed_text)
    check(processed["status"] == "ok", "页面结果处理保持 ok 状态")
    check(processed["canonical_ids"] == ["e2"], "页面处理后规范通道仍为 e2")
    check(processed["total_cost"] == E2_COST, "页面数据处理后总代价仍为完整整数值")
    check(processed["formatted_total_cost"] == str(E2_COST),
          f"格式化后的总代价为完整十进制 {E2_COST}（实际 {processed['formatted_total_cost']!r}）")
    check(processed["edge_costs"].get("e2") == str(E2_COST),
          f"格式化后的 e2 逐边代价为完整十进制 {E2_COST}（实际 {processed['edge_costs'].get('e2')!r}）")
    check(processed["tree_total"] == str(E2_COST),
          f"页面逐边精确合计 == 总代价（实际 {processed['tree_total']}）")

    # 5) 合法的超大代价不得仅因超过 2^53-1 被页面或 API 拒绝
    huge = "1" * 40  # 10^40-1，远超 2^53-1
    huge_spec = {
        "pointsText": "r a",
        "root": "r",
        "channelsText": f"h1, r, a, {huge}\n",
    }
    huge_req = run_node_pipeline("request", json.dumps(huge_spec))
    if huge_req is not None:
        st_h, body_h = http_raw("POST", f"{API}/api/solve", huge_req)
        check(st_h == 200 and json.loads(body_h).get("status") == "ok",
              f"合法超大代价 {huge} 不被页面/API 拒绝（实际 HTTP {st_h}）")


def verify_invalid_inputs() -> None:
    print("- 输入错误核对")
    # 自环
    self_loop = {
        "points": ["r", "a"], "root": "r",
        "channels": [{"id": "c1", "from": "a", "to": "a", "cost": 1}],
    }
    st, body = http("POST", f"{API}/api/solve", self_loop)
    check(st == 422 and body["status"] == "invalid", "自环返回 422/invalid")
    check(any("自环" in e for e in body.get("errors", [])), "自环原因明确")
    st2, body2 = http("POST", f"{WEB}/api/solve", self_loop)
    check(st2 == 422 and body2["status"] == "invalid", "页面反代同样拒绝自环")
    # 结构非法（根不在点集 + 点不足）
    bad = {"points": ["x"], "root": "nope", "channels": []}
    st, body = http("POST", f"{API}/api/solve", bad)
    check(st == 422 and body["status"] == "invalid", "结构非法返回 422/invalid")
    check(bool(body.get("errors")), "结构非法附带错误列表")
    # 负代价（pydantic 层）
    neg = {
        "points": ["r", "a"], "root": "r",
        "channels": [{"id": "c1", "from": "r", "to": "a", "cost": -3}],
    }
    st, body = http("POST", f"{API}/api/solve", neg)
    check(st == 422 and body["status"] == "invalid", "负代价返回 422/invalid")


def verify_http_smoke() -> None:
    print("- HTTP / 页面冒烟")
    for base, label in ((API, "API"), (WEB, "Web")):
        st, body = http("GET", f"{base}/api/health")
        check(st == 200 and body.get("status") == "ok", f"{label} 的 /api/health 可用")
    with urllib.request.urlopen(f"{WEB}/", timeout=5) as resp:
        html = resp.read().decode()
        check(resp.status == 200, "Web 首页 200")
        check('<div id="root">' in html, "首页包含 React 挂载点")
        check("/assets/" in html and html.count("<script") >= 1, "首页引用构建产物")


def main() -> int:
    print("== 等待服务就绪 ==")
    ok_api = wait_for(f"{API}/api/health", "api")
    ok_web = wait_for(f"{WEB}/", "web")
    if not (ok_api and ok_web):
        print("\nVERIFY FAILED:", "; ".join(FAILURES))
        return 1

    print("== 真实 API 与页面结果核对 ==")
    for name in ("nested", "parallel", "canonical"):
        verify_ok_scenario(name, SCENARIOS[name])
    verify_big_integer_boundary()
    verify_unreachable_scenario()
    verify_invalid_inputs()
    verify_http_smoke()

    if FAILURES:
        print(f"\nVERIFY FAILED（{len(FAILURES)} 项）:")
        for f in FAILURES:
            print("  -", f)
        return 1
    print("\nVERIFY PASSED：全部样例、记录复算、输入错误与冒烟检查通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
