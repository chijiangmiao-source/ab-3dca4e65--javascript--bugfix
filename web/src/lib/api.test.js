import { describe, expect, it } from "vitest";
import { buildSolveRequestBody, parseSolveResponse, treeTotalCost } from "./api";
import { parseChannels, parsePoints } from "./parse";

const E1 = 9007199254740993n;
const E2 = 9007199254740992n;

/** 按页面提交路径从文本构造请求体：parsePoints/parseChannels → buildSolveRequestBody。 */
function requestFromText(pointsText, root, channelsText) {
  const p = parsePoints(pointsText);
  const c = parseChannels(channelsText);
  return buildSolveRequestBody({ points: p.points, root, channels: c.channels });
}

describe("buildSolveRequestBody", () => {
  it("逐位保留超过安全整数范围的相邻代价", () => {
    const body = requestFromText(
      "r a",
      "r",
      `e1, r, a, ${E1}\ne2, r, a, ${E2}`
    );
    expect(body).toContain(`"cost":${E1.toString()}`);
    expect(body).toContain(`"cost":${E2.toString()}`);
  });
});

describe("parseSolveResponse", () => {
  it("把规范树响应中的总/逐边大整数还原为 BigInt 且合计逐位正确", () => {
    const raw =
      `{"status":"ok","total_cost":${E2.toString()},` +
      `"tree":[{"id":"e2","from":"r","to":"a","cost":${E2.toString()}}],` +
      `"canonical_ids":["e2"],` +
      `"record":{"levels":[],"expansions":[],"contractions":0}}`;
    const body = parseSolveResponse(raw);
    expect(body.total_cost).toBe(E2);
    expect(body.tree[0].cost).toBe(E2);
    expect(treeTotalCost(body.tree)).toBe(E2.toString());
  });
  it("非 ok 响应（无解 / 非法）同样可解析", () => {
    const body = parseSolveResponse('{"status":"unsolvable","unreachable":["z"]}');
    expect(body.status).toBe("unsolvable");
    expect(body.unreachable).toEqual(["z"]);
  });
});
