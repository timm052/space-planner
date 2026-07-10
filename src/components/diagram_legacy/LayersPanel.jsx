import { Empty } from '../ui.jsx';
import { distUnit } from '../../compute.js';
import LayerRow from './LayerRow.jsx';
import StagePopover from './StagePopover.jsx';

/**
 * The image-layer overlays: the ⧉ Layers popover (one LayerRow per image +
 * add buttons), the satellite-fetch form, and the two-point scale-calibration
 * panel. Chrome-only; the layers themselves draw inside the canvas.
 */

export function LayersPopover({
  imgLayers,
  dims,
  units,
  moveLayer,
  rotateLayer,
  onToggleVisible,
  onOpacity,
  onRotate,
  onFilter,
  onCalibrate,
  onToggleMove,
  onToggleRotate,
  onDelete,
  fileRef,
  onUpload,
  onAddSatellite,
  onClose,
}) {
  return (
    <StagePopover className="layers-popover" title="Image layers" onClose={onClose}>
      <div className="layers-list">
        {imgLayers.length === 0 && <Empty small>No images yet — add a site plan or satellite below.</Empty>}
        {imgLayers.map((im) => (
          <LayerRow
            key={im.id}
            title={`${im.kind === 'satellite' ? '🛰' : '🖼'} ${im.name || (im.kind === 'satellite' ? 'Satellite' : 'Image')}`}
            layer={im}
            dims={dims[im.id]}
            units={units}
            calibrated={im.mpp > 0}
            onToggleVisible={(v) => onToggleVisible(im, v)}
            onOpacity={(v) => onOpacity(im, v)}
            onRotate={(v) => onRotate(im, v)}
            onCalibrate={() => onCalibrate(im.id)}
            onMove={() => onToggleMove(im.id)}
            moving={moveLayer === im.id}
            onRotateMode={() => onToggleRotate(im.id)}
            rotating={rotateLayer === im.id}
            onFilter={(v) => onFilter(im, v)}
            onDelete={() => onDelete(im.id)}
          />
        ))}
      </div>
      <div className="layers-add">
        <button className="btn small" onClick={() => fileRef.current?.click()}>＋ Add image</button>
        <button className="btn small" onClick={onAddSatellite}>＋ Add satellite</button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onUpload} />
      <p className="hint popover-hint">
        Add as many images as you like. Calibrate each on its own and they share the diagram scale.
        Use <strong>Move</strong> and <strong>Rotate</strong> (then drag the canvas) to align a layer.
      </p>
    </StagePopover>
  );
}

/** The ＋ Add satellite form: address → Esri World Imagery at a chosen zoom. */
export function SatellitePanel({ satQuery, setSatQuery, satZoom, setSatZoom, satBusy, onFetch, onCancel }) {
  return (
    <form className="stage-popover sat-panel" onSubmit={onFetch}>
      <input placeholder="Site address or place (e.g. 1 Macquarie St, Sydney)" value={satQuery} onChange={(e) => setSatQuery(e.target.value)} required />
      <select value={satZoom} onChange={(e) => setSatZoom(e.target.value)}>
        <option value="16">Wide (~1.5 km)</option>
        <option value="17">Area (~750 m)</option>
        <option value="18">Site (~380 m)</option>
        <option value="19">Close (~190 m)</option>
      </select>
      <button className="btn primary small" disabled={satBusy}>
        {satBusy ? 'Fetching…' : 'Fetch imagery'}
      </button>
      <button type="button" className="btn small ghost" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

/** The calibration walkthrough: two clicks, then the real-world distance. */
export function ScalePanel({ scalePoints, layerName, scaleDistance, units, onDistance, onApply, onCancel }) {
  return (
    <div className="stage-popover scale-panel">
      {scalePoints.length < 2 ? (
        <span>
          Calibrating <strong>{layerName || 'image'}</strong> — click{' '}
          {scalePoints.length === 0 ? 'the first' : 'the second'} point of a known distance on it.
        </span>
      ) : (
        <>
          <span>Distance between the points:</span>
          <input type="number" min="0.1" step="any" autoFocus value={scaleDistance} onChange={(e) => onDistance(e.target.value)} placeholder={distUnit(units)} />
          <span>{distUnit(units)}</span>
          <button className="btn primary small" onClick={onApply}>
            Apply
          </button>
        </>
      )}
      <button className="btn small ghost" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
