import { Suspense, useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Html, useTexture, Line, Edges } from '@react-three/drei';
import * as THREE from 'three';

// A real WebGL 3-D view of the stacked floors: each storey is a thin slab at its
// own height, rooms are shaded spheres (or boxes) sitting on the slab, the site
// image is a texture on the ground floor, and adjacencies are 3-D lines drawn
// between the room centres. Orbit with the mouse; switch camera presets from the
// toolbar.
//
// Visual pipeline: ACES tone mapping, a hemisphere + shadowed key light rig,
// PCF-soft shadow maps caught by an invisible ShadowMaterial ground (so the
// scene grounds itself over EITHER app theme), physical materials with a
// subtle clearcoat on the rooms, fat anti-aliased lines for adjacencies
// (dashed = desired), and slab plates with crisp matching edge outlines.
//
// Coordinate mapping: plan x → world X, plan y → world Z, floor rank → world Y
// (up). Rooms arrive pre-centred on a shared footprint, so center is the origin.

const BOX_K = Math.sqrt(Math.PI); // box side for a circle of equal area = r·√π

// World-space centre of a room/endpoint sitting on its floor slab.
function roomCentre(x, y, rank, r, box, S, gapY) {
  const rW = Math.max(0.06, r * S);
  const half = box ? (rW * BOX_K) / 2 : rW;
  return new THREE.Vector3(x * S, rank * gapY + half + 0.06, y * S);
}

function GroundImage({ href, w, d, opacity }) {
  const texture = useTexture(href);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial map={texture} transparent opacity={opacity} toneMapped={false} />
      </mesh>
      {/* Invisible shadow catcher just above the image so the ground floor's
          rooms sit ON the site plan instead of floating over it. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <shadowMaterial transparent opacity={0.24} />
      </mesh>
    </>
  );
}

function Floor({ floor, S, gapY, image, showImage }) {
  const w = Math.max(0.1, (floor.maxX - floor.minX) * S);
  const d = Math.max(0.1, (floor.maxY - floor.minY) * S);
  const y = floor.rank * gapY;
  const imgW = image ? image.w * S : 0;
  const imgD = image ? image.h * S : 0;
  const imgX = image ? image.cx * S : 0;
  const imgZ = image ? image.cy * S : 0;
  return (
    <group position={[0, y, 0]}>
      <mesh frustumCulled={false} receiveShadow>
        <boxGeometry args={[w, 0.05, d]} />
        <meshStandardMaterial color={floor.color} transparent opacity={0.26} roughness={0.85} />
        {/* Crisp plate outline in the floor's own colour — reads as a drawn
            slab edge instead of a soft translucent blob. */}
        <Edges color={floor.color} threshold={30} />
      </mesh>
      {floor.rank === 0 && showImage && image && (
        <Suspense fallback={null}>
          <group position={[imgX, 0, imgZ]}>
            <GroundImage href={image.href} w={imgW} d={imgD} opacity={0.92} />
          </group>
        </Suspense>
      )}
      <Html position={[-w / 2, 0.1, -d / 2]} center={false} distanceFactor={18} occlude={false}>
        <div className="r3f-floor-label">{floor.label}</div>
      </Html>
    </group>
  );
}

function Room({ room, S, gapY }) {
  const rW = Math.max(0.06, room.r * S);
  const side = rW * BOX_K;

  // Freeform polygon: extrude the (area-locked) outline into a soft, bubble-like
  // cushion standing on the floor slab — a generous bevel rounds the top and
  // bottom edges so it reads as an inflated blob rather than a flat slab. Build
  // the THREE.Shape with -y so plan-y maps to world +Z.
  const depth = Math.max(0.4, rW * 0.95);
  const polyGeom = useMemo(() => {
    if (!room.poly) return null;
    const pts = room.poly.map((p) => new THREE.Vector2(p.x * S, -p.y * S));
    const shape = new THREE.Shape(pts);
    const bevel = Math.min(depth * 0.46, rW * 0.34); // rounded cap height
    const geom = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel * 0.85, // horizontal rounding for the puffy edge
      bevelSegments: 5,
      curveSegments: 1, // outline is already a dense sampled curve
      steps: 1,
    });
    geom.computeVertexNormals(); // smooth shading across the rounded edges
    return geom;
  }, [room.poly, S, rW, depth]);
  useEffect(() => () => polyGeom?.dispose(), [polyGeom]);

  if (polyGeom) {
    return (
      <group position={[room.x * S, room.rank * gapY + 0.06, room.y * S]}>
        <mesh castShadow geometry={polyGeom} rotation={[-Math.PI / 2, 0, 0]}>
          <meshPhysicalMaterial color={room.color} roughness={0.34} metalness={0.02} clearcoat={0.35} clearcoatRoughness={0.6} />
        </mesh>
        <Html position={[0, depth + 0.18, 0]} center distanceFactor={16} occlude={false}>
          <div className="r3f-room-label">{room.name}</div>
        </Html>
      </group>
    );
  }

  const p = roomCentre(room.x, room.y, room.rank, room.r, room.box, S, gapY);
  return (
    <group position={p.toArray()}>
      <mesh castShadow>
        {room.box ? <boxGeometry args={[side, side, side]} /> : <sphereGeometry args={[rW, 48, 32]} />}
        <meshPhysicalMaterial color={room.color} roughness={0.4} metalness={0.02} clearcoat={0.3} clearcoatRoughness={0.65} />
      </mesh>
      <Html position={[0, (room.box ? side / 2 : rW) + 0.12, 0]} center distanceFactor={16} occlude={false}>
        <div className="r3f-room-label">{room.name}</div>
      </Html>
    </group>
  );
}

// Camera presets. dir = view direction (target → camera); fov sets perspective
// strength — a small fov from far away reads as near-orthographic / isometric
// while keeping drei <Html> labels correct (true ortho breaks their scaling).
const CAM = {
  persp: { dir: [1, 0.85, 1.3], fov: 42 },
  iso: { dir: [1, 0.82, 1], fov: 16 },
  ortho: { dir: [1, 0.62, 1.25], fov: 12 },
  top: { dir: [0, 1, 0.0001], fov: 26 },
  front: { dir: [0.0001, 0.16, 1], fov: 24 },
  side: { dir: [1, 0.16, 0.0001], fov: 24 },
};

function Cameras({ mode, target, fit }) {
  const c = CAM[mode] || CAM.persp;
  const len = Math.hypot(...c.dir) || 1;
  // Distance that frames `fit` world units at this fov: D = fit / tan(fov/2).
  const dist = (fit / Math.tan((c.fov * Math.PI) / 360)) * 1.15;
  const pos = [
    target[0] + (c.dir[0] / len) * dist,
    target[1] + (c.dir[1] / len) * dist,
    target[2] + (c.dir[2] / len) * dist,
  ];
  return <PerspectiveCamera key={mode} makeDefault position={pos} fov={c.fov} near={0.1} far={dist * 4 + 300} />;
}

function Scene({ scene, gap, showImage, camMode }) {
  // Don't build the scene until the canvas has a real size — R3F can miss its
  // initial ResizeObserver callback when mounting into a freshly-shown panel,
  // and rendering at 0×0 throws transient NaN geometry warnings.
  const sized = useThree((s) => s.size.width > 1 && s.size.height > 1);
  const { foot, floors, rooms, links, image, floorCount } = scene;
  const S = 14 / Math.max(foot.w, foot.h, 1);
  const gapY = gap * 9;
  const topY = (floorCount - 1) * gapY;
  const midY = topY / 2;
  const span = Math.max(foot.w, foot.h) * S;
  const fit = Math.max(span, topY + span * 0.4);
  const shadowExtent = span * 1.3 + topY; // key-light ortho frustum half-size

  if (!sized) return null;

  return (
    <>
      {/* Light rig: cool sky/warm ground hemisphere ambience, one shadowed key
          light scaled to the scene, and a soft rim fill from behind. */}
      <hemisphereLight args={['#cfd9e8', '#20242e', 0.85]} />
      <directionalLight
        castShadow
        position={[span * 0.9, Math.max(14, topY + span * 1.1), span * 0.55]}
        intensity={1.6}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.03}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
        shadow-camera-near={0.5}
        shadow-camera-far={span * 4 + topY * 2 + 60}
      />
      <directionalLight position={[-span, topY + span * 0.5, -span * 0.7]} intensity={0.35} />

      <Cameras mode={camMode} target={[0, midY, 0]} fit={fit} />
      <OrbitControls key={camMode} target={[0, midY, 0]} makeDefault maxPolarAngle={Math.PI * 0.58} />

      {floors.map((f) => (
        <Floor key={f.label} floor={f} S={S} gapY={gapY} image={image} showImage={showImage} />
      ))}

      {/* Adjacency lines between the 3-D room centres — fat, anti-aliased
          lines (px-true width); desired links are dashed, required solid. */}
      {links.map((l, i) => {
        const a = roomCentre(l.a[0], l.a[1], l.a[2], l.a[3], l.a[4], S, gapY);
        const b = roomCentre(l.b[0], l.b[1], l.b[2], l.b[3], l.b[4], S, gapY);
        const required = l.strength === 'required';
        return (
          <Line
            key={`l${i}`}
            points={[a, b]}
            color={required ? '#aeb7c9' : '#57c7d4'}
            lineWidth={required ? 1.8 : 1.2}
            dashed={!required}
            dashSize={0.32}
            gapSize={0.22}
            transparent
            opacity={required ? 0.9 : 0.65}
          />
        );
      })}

      {rooms.map((room) => (
        <Room key={room.key} room={room} S={S} gapY={gapY} />
      ))}

      {/* Vertical corner posts tying the stack together. */}
      {floorCount > 1 &&
        [[foot.x0, foot.y0], [foot.x1, foot.y0], [foot.x1, foot.y1], [foot.x0, foot.y1]].map(([px, py], i) => (
          <Line
            key={`post${i}`}
            points={[new THREE.Vector3(px * S, 0, py * S), new THREE.Vector3(px * S, topY, py * S)]}
            color="#5b6478"
            lineWidth={1}
            dashed
            dashSize={0.2}
            gapSize={0.16}
            transparent
            opacity={0.55}
          />
        ))}

      {/* Ground: an invisible shadow catcher (works over either theme) with a
          faint drafting grid on top. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.42, 0]} receiveShadow>
        <circleGeometry args={[span * 1.5, 64]} />
        <shadowMaterial transparent opacity={0.32} />
      </mesh>
      <gridHelper args={[span * 2.4, 16, '#2c3340', '#1e242f']} position={[0, -0.4, 0]} />
    </>
  );
}

export default function Stacked3D({ scene, gap, showImage, camMode = 'persp' }) {
  // R3F sizes its canvas from a ResizeObserver whose initial callback can be
  // missed when the canvas mounts inside a freshly-shown panel; nudge it once.
  useEffect(() => {
    const id = setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    return () => clearTimeout(id);
  }, []);

  return (
    <Canvas
      dpr={[1, 2]}
      frameloop="demand"
      shadows
      gl={{ antialias: true, preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping }}
      style={{ background: 'transparent' }}
    >
      <Suspense fallback={null}>
        <Scene scene={scene} gap={gap} showImage={showImage} camMode={camMode} />
      </Suspense>
    </Canvas>
  );
}
