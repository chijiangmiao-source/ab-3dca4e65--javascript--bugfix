// 自动核对专用：驱动页面 src 中的真实模块，模拟「文本录入 → 请求提交」与
// 「响应 → 页面数据处理 / 格式化」两个阶段，供 verify.py 调用。
//
// 用法（规约 / 数据均经 stdin 传入）：
//   node page_pipeline.mjs request   # stdin: {pointsText, root, channelsText}
//       → 输出页面将发出的请求体原文（大整数逐位保留）
//   node page_pipeline.mjs process   # stdin: /api/solve 原始响应文本
//       → 输出页面处理后的结果（含逐边合计与十进制格式化文本）

import { buildSolveRequestBody, parseSolveResponse, treeTotalCost } from "../web/src/lib/api.js";
import { formatDecimal, stringifyJson } from "../web/src/lib/bigint.js";
import { parseChannels, parsePoints, validateAll } from "../web/src/lib/parse.js";

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/** 与 App.jsx submit() 相同的前置处理：文本解析 + 客户端校验 + 请求体构造。 */
function formPageRequest(spec) {
  const p = parsePoints(spec.pointsText);
  const c = parseChannels(spec.channelsText);
  const errors = [...p.errors, ...c.errors, ...validateAll(p.points, spec.root, c.channels)];
  if (errors.length) {
    throw new Error(`页面输入未通过客户端校验：\n${errors.join("\n")}`);
  }
  return buildSolveRequestBody({ points: p.points, root: spec.root, channels: c.channels });
}

/** 与页面结果处理一致：BigInt 解析 + 逐边合计 + 十进制格式化。 */
function processResponse(rawText) {
  const body = parseSolveResponse(rawText);
  if (body.status !== "ok") {
    return { status: body.status, reason: body.reason ?? null, errors: body.errors ?? [] };
  }
  const edgeCosts = {};
  for (const e of body.tree) edgeCosts[e.id] = formatDecimal(e.cost);
  return {
    status: "ok",
    canonical_ids: body.canonical_ids,
    total_cost: body.total_cost,
    formatted_total_cost: formatDecimal(body.total_cost),
    edge_costs: edgeCosts,
    tree_total: treeTotalCost(body.tree),
  };
}

async function main() {
  const mode = process.argv[2];
  const input = await readStdin();
  if (mode === "request") {
    process.stdout.write(formPageRequest(JSON.parse(input)));
  } else if (mode === "process") {
    process.stdout.write(stringifyJson(processResponse(input)));
  } else {
    throw new Error(`未知模式: ${mode}`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || String(err)}\n`);
  process.exit(1);
});
