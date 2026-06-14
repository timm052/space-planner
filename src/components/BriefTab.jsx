import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import {
  briefNet,
  targetTotal,
  subtreeArea,
  orderedTree,
  isContainerKind,
  childIdSet,
  fmtArea,
} from '../compute.js';

const NEW = { kind: 'space', department: '', name: '', count: 1, target_area: '' };

export default function BriefTab({ project, spaces, onChanged }) {
  const [form, setForm] = useState(NEW);
  const [addParent, setAddParent] = useState(null); // container id to add under
  const [editingId, setEditingId] = useState(null);
  const [edit, setEdit] = useState(NEW);
  const [error, setError] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dropId, setDropId] = useState(null); // 0 = top level
  const [focusId, setFocusId] = useState(null);
  const [expandedId, setExpandedId] = useState(null); // row whose notes/image panel is open
  const rowEls = useRef(new Map());
  const pendingFocus = useRef(null); // re-focus this row after the next refetch

  // Keep keyboard focus on the row the user just moved/indented, across refetch.
  useEffect(() => {
    if (pendingFocus.current != null) {
      rowEls.current.get(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  });

  async function reparent(id, parentId) {
    if (id === parentId) return;
    setError(null);
    try {
      await api.updateSpace(id, { parent_id: parentId });
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }
  function onDropRow(target) {
    const id = dragId;
    setDragId(null);
    setDropId(null);
    if (!id || id === target.id) return;
    // Drop onto a container → nest inside it; onto a leaf → become its sibling.
    const parent = isContainerKind(target) || parents.has(target.id) ? target.id : target.parent_id ?? null;
    reparent(id, parent);
  }

  const departments = [...new Set(spaces.map((s) => s.department).filter(Boolean))];
  const containers = spaces.filter((s) => isContainerKind(s));
  const tree = useMemo(() => orderedTree(spaces), [spaces]);
  const parents = useMemo(() => childIdSet(spaces), [spaces]);
  const byId = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const isContainerRow = (s) => isContainerKind(s) || parents.has(s.id);

  async function add(e) {
    e.preventDefault();
    setError(null);
    const isBuilding = form.kind === 'building';
    try {
      await api.createSpace(project.id, {
        kind: form.kind,
        parent_id: addParent,
        department: isBuilding ? 'Building' : form.department.trim() || 'General',
        name: form.name,
        count: isBuilding ? 1 : Number(form.count) || 1,
        target_area: isBuilding ? 0 : Number(form.target_area),
      });
      setForm({ ...NEW, kind: form.kind, department: isBuilding ? '' : form.department });
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(s) {
    setEditingId(s.id);
    setEdit({
      kind: s.kind,
      department: s.department,
      name: s.name,
      count: s.count,
      target_area: s.target_area,
      parent_id: s.parent_id,
    });
  }

  async function saveEdit(id) {
    setError(null);
    try {
      await api.updateSpace(id, {
        kind: edit.kind,
        department: edit.department,
        name: edit.name,
        count: Number(edit.count) || 1,
        target_area: Number(edit.target_area),
        parent_id: edit.parent_id ? Number(edit.parent_id) : null,
      });
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(s) {
    const kids = parents.has(s.id);
    const msg = kids
      ? `Delete "${s.name}" and everything inside it?`
      : `Remove "${s.name}" from the brief? Recorded areas for it will be lost.`;
    if (!window.confirm(msg)) return;
    await api.deleteSpace(s.id);
    if (editingId === s.id) setEditingId(null);
    onChanged();
  }

  // ---------- keyboard-first editing ----------
  function focusRow(id) {
    setFocusId(id);
    rowEls.current.get(id)?.focus();
  }
  function siblingsOf(space) {
    return spaces
      .filter((x) => (x.parent_id ?? null) === (space.parent_id ?? null))
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }
  async function moveWithin(space, dir) {
    const sibs = siblingsOf(space);
    const i = sibs.findIndex((x) => x.id === space.id);
    const j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    const reordered = [...sibs];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    pendingFocus.current = space.id;
    setError(null);
    try {
      // Normalise sort_order to position so a swap is unambiguous.
      for (let k = 0; k < reordered.length; k++) {
        if (reordered[k].sort_order !== k) await api.updateSpace(reordered[k].id, { sort_order: k });
      }
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }
  function indent(space) {
    const sibs = siblingsOf(space);
    const i = sibs.findIndex((x) => x.id === space.id);
    if (i <= 0) return; // nothing to nest under
    pendingFocus.current = space.id;
    reparent(space.id, sibs[i - 1].id);
  }
  function outdent(space) {
    if (space.parent_id == null) return;
    const parent = byId.get(space.parent_id);
    pendingFocus.current = space.id;
    reparent(space.id, parent ? parent.parent_id ?? null : null);
  }
  function onTreeKey(e, s) {
    if (editingId != null) return;
    const ids = tree.map((t) => t.space.id);
    const idx = ids.indexOf(s.id);
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveWithin(s, e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (ids[idx + 1] != null) focusRow(ids[idx + 1]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (ids[idx - 1] != null) focusRow(ids[idx - 1]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      e.shiftKey ? outdent(s) : indent(s);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      startEdit(s);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      remove(s);
    } else if (e.key.toLowerCase() === 'n') {
      e.preventDefault();
      setExpandedId(expandedId === s.id ? null : s.id);
    }
  }

  // ---------- per-space notes & reference image ----------
  async function saveNotes(space, value) {
    if (value === (space.notes ?? '')) return;
    setError(null);
    try {
      await api.updateSpace(space.id, { notes: value });
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }
  function onSpaceImage(space, e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) return setError('Reference image is too large (6 MB max).');
    const reader = new FileReader();
    reader.onload = async () => {
      setError(null);
      try {
        await api.updateSpace(space.id, { image: reader.result });
        onChanged();
      } catch (err) {
        setError(err.message);
      }
    };
    reader.readAsDataURL(file);
  }
  async function clearImage(space) {
    setError(null);
    try {
      await api.updateSpace(space.id, { image: null });
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  const parentOptions = containers.filter((c) => c.id !== editingId);
  const addingUnder = addParent != null ? byId.get(addParent) : null;
  const unit = project.units === 'ft2' ? 'ft²' : 'm²';

  return (
    <div>
      <form className="card brief-add" onSubmit={add}>
        <div className="brief-add-row">
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} title="A building/zone groups spaces; a space carries area">
            <option value="space">Space</option>
            <option value="building">Building / zone</option>
          </select>
          {form.kind !== 'building' && (
            <input list="departments" placeholder="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          )}
          <datalist id="departments">
            {departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <input placeholder={form.kind === 'building' ? 'Building name (e.g. Main Building)' : 'Space name (e.g. Reading Room)'} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          {form.kind !== 'building' && (
            <>
              <input type="number" min="1" placeholder="Count" title="Number of rooms of this type" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} />
              <input type="number" min="0.1" step="any" placeholder={`Area each (${unit})`} value={form.target_area} onChange={(e) => setForm({ ...form, target_area: e.target.value })} required />
            </>
          )}
          <button className="btn primary">+ Add</button>
        </div>
        <div className="brief-add-parent">
          {addingUnder ? (
            <span>
              Adding inside <strong>{addingUnder.name}</strong>{' '}
              <button type="button" className="btn small ghost" onClick={() => setAddParent(null)}>
                move to top level
              </button>
            </span>
          ) : (
            <span className="muted">
              Adding at top level
              {containers.length > 0 && ' · use “+ inside” on a building row to nest'}
            </span>
          )}
        </div>
      </form>
      {error && <div className="banner error">{error}</div>}

      {spaces.length > 0 && (
        <p className="brief-hint hint">
          Keyboard: click a row, then <kbd>↑</kbd>/<kbd>↓</kbd> move · <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> reorder ·{' '}
          <kbd>Tab</kbd>/<kbd>⇧Tab</kbd> nest/unnest · <kbd>Enter</kbd> edit · <kbd>N</kbd> notes · <kbd>Del</kbd> remove.
        </p>
      )}

      {spaces.length === 0 ? (
        <div className="empty">The brief is empty. Add a building or the client's required spaces above.</div>
      ) : (
        <div className="card">
          <table className="table brief-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Department</th>
                <th className="num">Count</th>
                <th className="num">Area each</th>
                <th className="num">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dragId != null && (
                <tr
                  className={`toplevel-drop ${dropId === 0 ? 'drop-target' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDropId(0); }}
                  onDrop={(e) => { e.preventDefault(); const id = dragId; setDragId(null); setDropId(null); reparent(id, null); }}
                >
                  <td colSpan="6">↥ Drop here to move to top level (ungroup)</td>
                </tr>
              )}
              {tree.map(({ space: s, depth }) =>
                editingId === s.id ? (
                  <tr key={s.id} className="editing">
                    <td style={{ paddingLeft: 10 + depth * 20 }}>
                      <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                    </td>
                    <td>
                      {edit.kind === 'building' ? (
                        <span className="muted">—</span>
                      ) : (
                        <input value={edit.department} onChange={(e) => setEdit({ ...edit, department: e.target.value })} />
                      )}
                    </td>
                    <td className="num">
                      {edit.kind === 'building' ? <span className="muted">—</span> : <input type="number" min="1" value={edit.count} onChange={(e) => setEdit({ ...edit, count: e.target.value })} />}
                    </td>
                    <td className="num">
                      {edit.kind === 'building' ? <span className="muted">—</span> : <input type="number" min="0.1" step="any" value={edit.target_area} onChange={(e) => setEdit({ ...edit, target_area: e.target.value })} />}
                    </td>
                    <td className="num">
                      <select className="parent-select" value={edit.parent_id || ''} onChange={(e) => setEdit({ ...edit, parent_id: e.target.value })} title="Parent container">
                        <option value="">Top level</option>
                        {parentOptions.map((c) => (
                          <option key={c.id} value={c.id}>
                            in {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="row-actions">
                      <button className="btn small primary" onClick={() => saveEdit(s.id)} type="button">
                        Save
                      </button>
                      <button className="btn small ghost" onClick={() => setEditingId(null)} type="button">
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <Fragment key={s.id}>
                    <tr
                      ref={(el) => (el ? rowEls.current.set(s.id, el) : rowEls.current.delete(s.id))}
                      tabIndex={0}
                      className={`${isContainerRow(s) ? 'container-row' : ''} ${dragId === s.id ? 'dragging' : ''} ${dropId === s.id ? 'drop-target' : ''} ${focusId === s.id ? 'kb-focus' : ''}`}
                      draggable
                      onFocus={() => setFocusId(s.id)}
                      onKeyDown={(e) => onTreeKey(e, s)}
                      onDragStart={() => setDragId(s.id)}
                      onDragEnd={() => (setDragId(null), setDropId(null))}
                      onDragOver={(e) => { e.preventDefault(); if (dropId !== s.id) setDropId(s.id); }}
                      onDrop={(e) => { e.preventDefault(); onDropRow(s); }}
                    >
                      <td style={{ paddingLeft: 10 + depth * 20 }}>
                        <span className="drag-grip" title="Drag to move / nest">⠿</span>
                        <span className="kind-icon">{isContainerRow(s) ? '▦' : '·'}</span>
                        {s.name}
                        {s.notes ? <span className="row-flag" title="Has notes">📝</span> : null}
                        {s.image ? <span className="row-flag" title="Has reference image">🖼</span> : null}
                      </td>
                      <td>{isContainerKind(s) ? <span className="muted">{s.kind}</span> : s.department}</td>
                      <td className="num">{isContainerKind(s) ? '—' : s.count}</td>
                      <td className="num">{isContainerKind(s) ? '—' : fmtArea(s.target_area, project.units)}</td>
                      <td className="num strong">{fmtArea(isContainerRow(s) ? subtreeArea(s, spaces) : targetTotal(s), project.units)}</td>
                      <td className="row-actions">
                        {isContainerRow(s) && (
                          <button className="btn small ghost" onClick={() => setAddParent(s.id)} type="button" title={`Add a space inside ${s.name}`}>
                            + inside
                          </button>
                        )}
                        <button className={`btn small ghost ${expandedId === s.id ? 'primary' : ''}`} onClick={() => setExpandedId(expandedId === s.id ? null : s.id)} type="button" title="Notes & reference image (N)">
                          Notes
                        </button>
                        <button className="btn small ghost" onClick={() => startEdit(s)} type="button">
                          Edit
                        </button>
                        <button className="btn small ghost danger" onClick={() => remove(s)} type="button">
                          ✕
                        </button>
                      </td>
                    </tr>
                    {expandedId === s.id && (
                      <tr className="detail-row">
                        <td colSpan="6">
                          <div className="space-detail" style={{ marginLeft: depth * 20 }}>
                            <div className="detail-notes">
                              <label className="detail-label">Notes</label>
                              <textarea
                                defaultValue={s.notes ?? ''}
                                placeholder="Design notes, client requirements, references…"
                                onBlur={(e) => saveNotes(s, e.target.value)}
                              />
                            </div>
                            <div className="detail-image">
                              <label className="detail-label">Reference image</label>
                              {s.image ? (
                                <div className="detail-thumb">
                                  <img src={s.image} alt={`${s.name} reference`} />
                                  <button className="btn small ghost danger" type="button" onClick={() => clearImage(s)}>
                                    Remove
                                  </button>
                                </div>
                              ) : (
                                <label className="btn small">
                                  Upload…
                                  <input type="file" accept="image/*" hidden onChange={(e) => onSpaceImage(s, e)} />
                                </label>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="4">Brief net total (all rooms)</td>
                <td className="num strong">{fmtArea(briefNet(spaces), project.units)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
