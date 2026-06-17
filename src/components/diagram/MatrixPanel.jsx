/**
 * Adjacency matrix modal. Click a cell to cycle the relationship between two
 * spaces: none → desired → required → none. Changes are undoable (caller
 * handles the history via `onCycle`).
 *
 * @param {Array}    leaves      - Leaf space objects (rows and columns).
 * @param {Array}    adjacencies - Current adjacency rows from the DB.
 * @param {function} colorOf     - (space) → CSS colour string.
 * @param {function} onCycle     - (spaceIdA, spaceIdB) → Promise<void>
 * @param {function} onClose     - Close handler.
 */
export default function MatrixPanel({ leaves, adjacencies, colorOf, onCycle, onClose }) {
  const strengthOf = (a, b) => {
    const l = adjacencies.find(
      (x) => (x.space_a === a && x.space_b === b) || (x.space_a === b && x.space_b === a)
    );
    return l?.strength ?? null;
  };

  const glyph = { required: '●', desired: '○' };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal matrix-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Adjacency matrix</h2>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        <p className="hint">
          Click a cell to cycle the relationship: blank → <b>○ desired</b> → <b>● required</b> → blank.
          Changes sync with the diagram and are undoable.
        </p>
        <div className="matrix-scroll">
          <table className="matrix">
            <thead>
              <tr>
                <th className="corner" />
                {leaves.map((s) => (
                  <th key={s.id} className="mcol" title={s.name}>
                    <span>{s.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leaves.map((row, ri) => (
                <tr key={row.id}>
                  <th className="mrow" title={row.name}>
                    <span className="legend-dot" style={{ background: colorOf(row) }} />
                    {row.name}
                  </th>
                  {leaves.map((col, ci) => {
                    if (ci === ri) return <td key={col.id} className="mdiag" />;
                    if (ci > ri) return <td key={col.id} className="mvoid" />;
                    const st = strengthOf(row.id, col.id);
                    return (
                      <td
                        key={col.id}
                        className={`mcell ${st || ''}`}
                        title={`${row.name} ↔ ${col.name}`}
                        onClick={() => onCycle(row.id, col.id)}
                      >
                        {glyph[st] || ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
