import { IMAGE_FILTERS } from '../../geometry.js';
import { distUnit } from '../../compute.js';

/**
 * A single image-layer row in the Layers panel. Shows the layer name,
 * calibration status, opacity/rotation controls, filter picker, and
 * action buttons (calibrate, move, rotate, delete).
 */
export default function LayerRow({
  title, layer, dims, units, calibrated,
  onToggleVisible, onOpacity, onRotate, onCalibrate,
  onMove, moving, onRotateMode, rotating, onFilter, onDelete,
  onOffset, effScale,
}) {
  let scaleNote = '';
  if (calibrated && dims) {
    const realW = dims.w * layer.mpp;
    scaleNote = `${Math.round(realW).toLocaleString()} ${distUnit(units)}`;
  }

  return (
    <div className="layer-row">
      <div className="layer-head">
        <label className="switch" title="Show or hide this layer">
          <input type="checkbox" checked={!!layer.visible} onChange={(e) => onToggleVisible(e.target.checked)} />
          <span className="layer-name">{title}</span>
        </label>
        <span
          className={`layer-cal ${calibrated ? 'ok' : 'warn'}`}
          title={calibrated ? `${scaleNote} wide` : 'Not calibrated — use 📏 to set the scale'}
        >
          {calibrated ? scaleNote : 'uncal.'}
        </span>
        <button className="btn small ghost danger layer-del" onClick={onDelete} title="Remove this image">✕</button>
      </div>
      <div className="layer-ctrls">
        <span className="opacity-mini" title="Opacity">
          ◐
          <input
            type="range" min="0.1" max="1" step="0.05"
            value={layer.opacity}
            onChange={(e) => onOpacity(Number(e.target.value))}
          />
        </span>
        <span className="rot-field" title="Rotation in degrees (clockwise)">
          ⟳
          <input
            type="number" step="1"
            value={Math.round(layer.rot || 0)}
            onChange={(e) => onRotate(((Number(e.target.value) % 360) + 360) % 360)}
          />
        </span>
        {/* Position, in the same real units the drawing is in. Rotation has
            always been typeable while position was drag-only, which meant a
            survey could be squared up to the degree and then nudged into place
            by eye. Offsets are relative to the diagram centre; with a drawing
            scale set they read in metres, else in diagram units. */}
        {onOffset && (
          <span className="xy-field" title={`Offset from the diagram centre${effScale ? ` (${distUnit(units)})` : ' (diagram units)'}`}>
            ✥
            <input
              type="number" step={effScale ? 0.1 : 1}
              value={+(((layer.x || 0) * (effScale || 1))).toFixed(effScale ? 1 : 0)}
              aria-label="Horizontal offset"
              onChange={(e) => onOffset({ x: Number(e.target.value) / (effScale || 1) })}
            />
            <input
              type="number" step={effScale ? 0.1 : 1}
              value={+(((layer.y || 0) * (effScale || 1))).toFixed(effScale ? 1 : 0)}
              aria-label="Vertical offset"
              onChange={(e) => onOffset({ y: Number(e.target.value) / (effScale || 1) })}
            />
          </span>
        )}
        <select
          className="filter-select"
          value={layer.filter || ''}
          onChange={(e) => onFilter(e.target.value)}
          title="Diagrammatic filter"
        >
          {IMAGE_FILTERS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <button className="btn small" onClick={onCalibrate} title="Calibrate scale — mark a known distance">📏</button>
        <button className={`btn small ${moving ? 'on' : ''}`} onClick={onMove} title="Move — then drag the canvas">✥</button>
        <button className={`btn small ${rotating ? 'on' : ''}`} onClick={onRotateMode} title="Rotate — then drag the canvas">⟲</button>
      </div>
    </div>
  );
}
