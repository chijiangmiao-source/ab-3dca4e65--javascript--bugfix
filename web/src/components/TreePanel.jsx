/** 规范树边列表：逐边代价、总代价与来自收缩记录的证据标注。 */
import { formatBigInt } from "../lib/bigintjson";

export default function TreePanel({ tree, totalCost, evidence, selectedId, onSelect }) {
  const byId = new Map(tree.map((e) => [e.id, e]));
  // 逐边代价可能超过 2^53−1，合计必须以 BigInt 完成
  const total = tree.reduce((s, e) => s + BigInt(e.cost), 0n);
  return (
    <div className="tree-panel">
      <h3>
        规范汇流树
        <span className="total">总代价 {formatBigInt(totalCost)}</span>
      </h3>
      <p className="hint">同优树中按升序通道标识序列取字典序最小；点击边可在网络图中定位。</p>
      <table className="tree-table">
        <thead>
          <tr>
            <th>通道</th>
            <th>方向</th>
            <th>代价</th>
            <th>证据（来自可复算记录）</th>
          </tr>
        </thead>
        <tbody>
          {tree.map((e) => (
            <tr
              key={e.id}
              className={selectedId === e.id ? "selected" : ""}
              onClick={() => onSelect(e.id)}
            >
              <td><code>{e.id}</code></td>
              <td>{e.from} → {e.to}</td>
              <td className="num">{formatBigInt(e.cost)}</td>
              <td className="evidence">
                {(evidence.get(e.id) || []).map((tag, i) => (
                  <span key={i} className={`badge badge-${tag.kind}`}>{tag.text}</span>
                ))}
                {(!evidence.get(e.id) || evidence.get(e.id).length === 0) && (
                  <span className="muted">第 0 层最低入口</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan="2" className="num">合计</td>
            <td className="num strong">{formatBigInt(total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
