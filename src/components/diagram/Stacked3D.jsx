import { Suspense, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Html, useTexture } from '@react-three/drei';
import * as THREE from 'three';

// A real WebGL 3-D view of the stacked floors: each storey is a thin slab at its
// own height, rooms are shaded spheres (or boxes) sitting on the slab, the site
// image is a texture on the ground floor, and adjacencies are 3-D lines drawn
// between the room centres. Orbit with the mouse; switch camera presets from the
// toolbar.
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
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
      <planeGeometry args={[w, d]} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} toneMapped={false} />
    </mesh>
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
      <mesh frustumCulled={false}>
        <boxGeometry args={[w, 0.05, d]} />
        <meshStandardMaterial color={floor.color} transparent opacity={0.18} roughness={0.9} />
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
  const p = roomCentre(room.x, room.y, room.rank, room.r, room.box, S, gapY);
  return (
    <group position={p.toArray()}>
      <mesh castShadow>
        {room.box ? <boxGeometry args={[side, side, side]} /> : <sphereGeometry args={[rW, 32, 24]} />}
        <meshStandardMaterial color={room.color} roughness={0.35} metalness={0.05} />
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

  if (!sized) return null;

  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[8, 18, 10]} intensity={1.1} />
      <directionalLight position={[-10, 8, -6]} intensity={0.35} />

      <Cameras mode={camMode} target={[0, midY, 0]} fit={fit} />
      <OrbitControls key={camMode} target={[0, midY, 0]} makeDefault />

      {floors.map((f) => (
        <Floor key={f.label} floor={f} S={S} gapY={gapY} image={image} showImage={showImage} />
      ))}

      {/* Adjacency lines, drawn between the 3-D room centres (not the ground). */}
      {links.map((l, i) => {
        const a = roomCentre(l.a[0], l.a[1], l.a[2], l.a[3], l.a[4], S, gapY);
        const b = roomCentre(l.b[0], l.b[1], l.b[2], l.b[3], l.b[4], S, gapY);
        const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
        return (
          <line key={`l${i}`} geometry={geom} frustumCulled={false}>
            <lineBasicMaterial
              color={l.strength === 'required' ? '#aeb7c9' : '#57c7d4'}
              transparent
              opacity={l.strength === 'required' ? 0.85 : 0.55}
            />
          </line>
        );
      })}

      {rooms.map((room) => (
        <Room key={room.key} room={room} S={S} gapY={gapY} />
      ))}

      {/* Vertical corner posts tying the stack together. */}
      {floorCount > 1 &&
        [[foot.x0, foot.y0], [foot.x1, foot.y0], [foot.x1, foot.y1], [foot.x0, foot.y1]].map(([px, py], i) => {
          const geom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(px * S, 0, py * S),
            new THREE.Vector3(px * S, topY, py * S),
          ]);
          return (
            <line key={`post${i}`} geometry={geom} frustumCulled={false}>
              <lineBasicMaterial color="#5b6478" transparent opacity={0.5} />
            </line>
          );
        })}

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
    <Canvas dpr={[1, 2]} frameloop="demand" gl={{ antialias: true }} style={{ background: 'transparent' }}>
      <Suspense fallback={null}>
        <Scene scene={scene} gap={gap} showImage={showImage} camMode={camMode} />
      </Suspense>
    </Canvas>
  );
}
