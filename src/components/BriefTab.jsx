import { useMemo, useState } from 'react';
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
                  <tr
                    key={s.id}
                    className={`${isContainerRow(s) ? 'container-row' : ''} ${dragId === s.id ? 'dragging' : ''} ${dropId === s.id ? 'drop-target' : ''}`}
                    draggable
                    onDragStart={() => setDragId(s.id)}
                    onDragEnd={() => (setDragId(null), setDropId(null))}
                    onDragOver={(e) => { e.preventDefault(); if (dropId !== s.id) setDropId(s.id); }}
                    onDrop={(e) => { e.preventDefault(); onDropRow(s); }}
                  >
                    <td style={{ paddingLeft: 10 + depth * 20 }}>
                      <span className="drag-grip" title="Drag to move / nest">⠿</span>
                      <span className="kind-icon">{isContainerRow(s) ? '▦' : '·'}</span>
                      {s.name}
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
                      <button className="btn small ghost" onClick={() => startEdit(s)} type="button">
                        Edit
                      </button>
                      <button className="btn small ghost danger" onClick={() => remove(s)} type="button">
                        ✕
                      </button>
                    </td>
                  </tr>
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
