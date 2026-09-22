// 页面大整数通道代价端到端验收。
//
// 直接复用页面源码（src/lib/parse.js、src/lib/bigintjson.js），模拟用户在
// 文本框中录入后由 App.submit() 形成请求的全过程，并经 web 同源反代提交给
// 真实 API；再用手写的精确整数 JSON 直连 API，断言两条路径结果一致，且：
//   - 相邻大整数 9007199254740993 / 9007199254740992 保持原有大小关系；
//   - 规范树选择实际更便宜的 e2（而非被 double 舍入同价后按标识选 e1）；
//   - 响应经页面数据处理（parseJsonBigInts）与格式化（formatBigInt、
//     TreePanel 同款 BigInt 求和）后，总代价与逐边代价仍是完整十进制。
// 任一断言失败即以非零码退出。

import assert from "node:assert/strict";
import { parseChannels, parsePoints, validateAll } from "../web/src/lib/parse.js";
import {
  compareBigInt,
  formatBigInt,
  parseJsonBigInts,
  stringifyJsonBigInts,
  toBigInt,
} from "../web/src/lib/bigintjson.js";

const API = process.env.API_BASE || "http://api:8000";
const WEB = process.env.WEB_BASE || "http://web";

const BIG_PLUS_ONE = "9007199254740993"; // 2^53 + 1
const BIG = "9007199254740992"; // 2^53

const failures = [];
function check(desc, fn) {
  try {
    fn();
    console.log(`  [PASS] ${desc}`);
  } catch (err) {
    console.log(`  [FAIL] ${desc}\n         ${err.message.split("\n")[0]}`);
    failures.push(desc);
  }
}

async function post(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const text = await resp.text();
  return { status: resp.status, text, json: parseJsonBigInts(text) };
}

async function main() {
  console.log("== 页面录入 → 请求提交 → 响应展示 的大整数精度验收 ==");

  // --- 1. 页面文本录入：与用户在文本框中输入完全一致 ---
  const pointsText = "r a";
  const root = "r";
  const channelsText = `e1, r, a, ${BIG_PLUS_ONE}\ne2, r, a, ${BIG}`;

  const { points, errors: pErr } = parsePoints(pointsText);
  const { channels, errors: cErr } = parseChannels(channelsText);
  const vErr = validateAll(points, root, channels);

  check("页面解析无校验错误（合法大整数不得被拒绝）", () => {
    assert.deepEqual([...pErr, ...cErr, ...vErr], []);
  });

  check("两个相邻大整数在解析后保持不同的完整十进制文本", () => {
    const e1 = channels.find((c) => c.id === "e1");
    const e2 = channels.find((c) => c.id === "e2");
    assert.equal(e1.cost, BIG_PLUS_ONE);
    assert.equal(e2.cost, BIG);
    assert.notEqual(e1.cost, e2.cost);
    assert.equal(compareBigInt(e1.cost, e2.cost), 1);
  });

  // --- 2. 按 App.submit() 同样的方式序列化并经页面同源反代提交 ---
  const pageRequestBody = stringifyJsonBigInts({
    points,
    root,
    channels: channels.map((c) => ({
      id: c.id,
      from: c.from,
      to: c.to,
      cost: toBigInt(c.cost),
    })),
  });

  check("页面请求体以裸整数字面量携带 9007199254740993（无引号、未被舍入）", () => {
    assert.match(pageRequestBody, /"cost":9007199254740993([,}])/);
    assert.match(pageRequestBody, /"cost":9007199254740992([,}])/);
    assert.doesNotMatch(pageRequestBody, /"900719925474099[23]"/);
  });

  // 外部客户端手写精确整数 JSON（不经过任何 JS Number）直连真实 API
  const directRequestBody =
    `{"points":["r","a"],"root":"r","channels":[` +
    `{"id":"e1","from":"r","to":"a","cost":${BIG_PLUS_ONE}},` +
    `{"id":"e2","from":"r","to":"a","cost":${BIG}}]}`;

  const viaPage = await post(`${WEB}/api/solve`, pageRequestBody);
  const directApi = await post(`${API}/api/solve`, directRequestBody);

  check("页面反代提交与精确整数直连 API 均返回 200/ok", () => {
    assert.equal(viaPage.status, 200);
    assert.equal(directApi.status, 200);
    assert.equal(viaPage.json.status, "ok");
    assert.equal(directApi.json.status, "ok");
  });

  check("页面输入形成的请求与精确整数直接请求得到完全相同结果", () => {
    assert.deepEqual(viaPage.json, directApi.json);
  });

  check("相邻大整数保持大小关系，规范通道为实际更便宜的 e2", () => {
    assert.equal(BigInt(BIG_PLUS_ONE) > BigInt(BIG), true);
    assert.deepEqual(viaPage.json.canonical_ids, ["e2"]);
    assert.deepEqual(directApi.json.canonical_ids, ["e2"]);
  });

  check("响应线路文本包含完整十进制 9007199254740992", () => {
    assert.ok(viaPage.text.includes(BIG), `页面反代响应缺少 ${BIG}`);
    assert.ok(directApi.text.includes(BIG), `API 直连响应缺少 ${BIG}`);
    assert.doesNotMatch(viaPage.text, /9\.007199254740992e\+?15/);
  });

  // --- 3. 响应进入页面数据处理与格式化 ---
  const body = viaPage.json;
  const e2 = body.tree.find((e) => e.id === "e2");
  const treeSum = body.tree.reduce((s, e) => s + BigInt(e.cost), 0n); // 与 TreePanel 同款合计

  check("页面处理后总代价为完整十进制 9007199254740992", () => {
    assert.equal(typeof body.total_cost, "bigint");
    assert.equal(body.total_cost, BigInt(BIG));
    assert.equal(formatBigInt(body.total_cost), BIG);
  });

  check("页面处理后 e2 的逐边代价为完整十进制 9007199254740992", () => {
    assert.ok(e2, "响应树缺少 e2");
    assert.equal(typeof e2.cost, "bigint");
    assert.equal(e2.cost, BigInt(BIG));
    assert.equal(formatBigInt(e2.cost), BIG);
  });

  check("TreePanel 同款 BigInt 合计等于总代价且格式化完整", () => {
    assert.equal(treeSum, body.total_cost);
    assert.equal(formatBigInt(treeSum), BIG);
  });

  if (failures.length) {
    console.error(`\nPAGE PIPELINE VERIFY FAILED（${failures.length} 项）:`);
    for (const f of failures) console.error("  -", f);
    process.exit(1);
  }
  console.log("\nPAGE PIPELINE VERIFY PASSED：页面大整数精度端到端保持。");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
