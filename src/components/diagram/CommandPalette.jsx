import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Ctrl/Cmd+K quick-select palette: find a room by name to select it and pan
 * the diagram there, or run a diagram command (switch environment, go to a
 * floor, fit the view, …). Pure UI — everything it can do arrives as props.
 *
 * @param {boolean}  open        - Render + focus the palette.
 * @param {function} onClose     - Dismiss (overlay click, Esc, or after a pick).
 * @param {Array}    rooms       - [{ space, name, icon, sub, color }] pickable spaces.
 * @param {Array}    commands    - [{ id, label, hint, run }] actions.
 * @param {function} onPickRoom  - (space) → select + pan the diagram.
 */
export default function CommandPalette({ open, onClose, rooms, commands, onPickRoom }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Fresh query + focus every time the palette opens.
  useEffect(() => {
    if (!open) return undefined;
    setQ('');
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const items = useMemo(() => {
    if (!open) return [];
    const needle = q.trim().toLowerCase();
    // 3 = starts with, 2 = contains, 1 = no query (show everything).
    const score = (label) => {
      if (!needle) return 1;
      const l = label.toLowerCase();
      return l.startsWith(needle) ? 3 : l.includes(needle) ? 2 : 0;
    };
    const rows = [];
    for (const c of commands) {
      const m = score(c.label);
      if (m) rows.push({ kind: 'cmd', score: m, ...c });
    }
    for (const r of rooms) {
      const m = score(r.name);
      if (m) rows.push({ kind: 'room', score: m, key: `room:${r.space.id}`, ...r });
    }
    rows.sort((a, b) => b.score - a.score); // stable — keeps given order within a band
    return rows.slice(0, 12);
  }, [open, q, rooms, commands]);

  // Keep the active row visible while arrowing through a long list.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const run = (it) => {
    onClose();
    if (it.kind === 'room') onPickRoom(it.space);
    else it.run();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[active]) run(items[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="modal-overlay palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          className="palette-input"
          type="text"
          value={q}
          placeholder="Find a room or command…"
          aria-label="Find a room or command"
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
        />
        <div className="palette-list" ref={listRef}>
          {items.map((it, i) => (
            <button
              key={it.key ?? it.id}
              className={`palette-row ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(it)}
            >
              {it.kind === 'room' ? (
                <>
                  <span className="palette-dot" style={{ background: it.color }} />
                  <span className="palette-name">{it.icon ? `${it.icon} ` : ''}{it.name}</span>
                  {it.sub && <span className="palette-sub mono">{it.sub}</span>}
                </>
              ) : (
                <>
                  <span className="palette-cmd">▸</span>
                  <span className="palette-name">{it.label}</span>
                  {it.hint && <span className="palette-sub">{it.hint}</span>}
                </>
              )}
            </button>
          ))}
          {items.length === 0 && <div className="palette-empty">No matches</div>}
        </div>
        <div className="palette-foot">↑↓ navigate · Enter select · Esc close</div>
      </div>
    </div>
  );
}
