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
export default function MatrixPanel({ leaves, adjacencies, colorOf, onCycle, onClose, linkStates = null }) {
  const strengthOf = (a, b) => {
    const l = adjacencies.find(
      (x) => (x.space_a === a && x.space_b === b) || (x.space_a === b && x.space_b === a)
    );
    return l?.strength ?? null;
  };
  // Current-layout satisfaction per pair ('met' | 'unmet'), computed by the
  // caller when the modal opens — the matrix audits the layout, not just the
  // declarations. Null when the environment can't grade (e.g. no scale).
  const stateOf = (a, b) => linkStates?.get(a < b ? `${a}:${b}` : `${b}:${a}`) ?? null;

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
          {linkStates && (
            <>
              {' '}Marks are graded against the current layout — <b className="mm-met">met</b> · <b className="mm-unmet">unmet</b>.
            </>
          )}
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
                    const state = st ? stateOf(row.id, col.id) : null;
                    return (
                      <td
                        key={col.id}
                        className={`mcell ${st || ''} ${state || ''}`}
                        title={`${row.name} ↔ ${col.name}${state ? ` — ${state} in the current layout` : ''}`}
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
