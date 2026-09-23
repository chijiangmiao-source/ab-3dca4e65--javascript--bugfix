import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TreePanel from "./TreePanel.jsx";
import RecordPanel from "./RecordPanel.jsx";

const BIG = 9007199254740992n;

describe("<TreePanel /> 大整数展示", () => {
  it("总代价、逐边代价与合计均输出完整十进制，且不经 Number 舍入", () => {
    const tree = [
      { id: "e2", from: "r", to: "a", cost: BIG },
      { id: "e3", from: "a", to: "b", cost: 1n },
    ];
    const html = renderToString(
      <TreePanel tree={tree} totalCost={BIG + 1n} evidence={new Map()} onSelect={() => {}} />
    );
    expect(html).toContain(BIG.toString());
    expect(html).toContain((BIG + 1n).toString());
    // 合计行与总代价一致（逐边精确求和），且不是 Number 舍入的结果
    expect(html).toContain("9007199254740993");
    expect(html).not.toContain("9.007199254740992e");
  });
});

describe("<RecordPanel /> 大整数代价修正", () => {
  it("原始代价与修正代价完整展示，精确相减不丢位", () => {
    const record = {
      levels: [
        {
          depth: 0,
          nodes: ["a", "r"],
          chosen: [{ node: "a", channel: "e2", cost: BIG }],
          cycle: {
            nodes: ["a"],
            channels: ["e2"],
            supernode: "S1",
            rewired_in: [
              {
                channel: "e1",
                from: "r",
                to: "a",
                original_cost: BIG,
                adjusted_cost: 1n,
                enters: "a",
              },
            ],
            rewired_out: [],
            dropped_internal: [],
          },
        },
      ],
      expansions: [],
    };
    const html = renderToString(
      <RecordPanel record={record} selectedItem={null} onSelect={() => {}} />
    );
    expect(html).toContain(BIG.toString());
    expect(html).toContain((BIG - 1n).toString());
  });
});
