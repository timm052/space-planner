import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html, Edges, useTexture } from '@react-three/drei';
import * as THREE from 'three';

// A real WebGL 3-D view of the stacked floors: each storey is a thin slab at its
// own height, rooms are shaded spheres sitting on the slab, the site image is a
// texture on the ground floor, and adjacencies are 3-D lines. Orbit with the
// mouse (drag = rotate, wheel = zoom, right-drag = pan).
//
// Coordinate mapping: plan x → world X, plan y → world Z, floor rank → world Y
// (up). Everything is scaled so the footprint is a comfortable size on screen.

function GroundImage({ href, w, d, opacity }) {
  const texture = useTexture(href);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
      <planeGeometry args={[w, d]} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} toneMapped={false} />
    </mesh>
  );
}

function Floor({ floor, S, gapY, center, image, showImage }) {
  const w = Math.max(0.1, (floor.maxX - floor.minX) * S);
  const d = Math.max(0.1, (floor.maxY - floor.minY) * S);
  const cx = ((floor.minX + floor.maxX) / 2 - center.x) * S;
  const cz = ((floor.minY + floor.maxY) / 2 - center.y) * S;
  const y = floor.rank * gapY;
  // Ground-image plane sized/placed by its own footprint, relative to this slab.
  const imgW = image ? image.w * S : 0;
  const imgD = image ? image.h * S : 0;
  const imgX = image ? (image.cx - (floor.minX + floor.maxX) / 2) * S : 0;
  const imgZ = image ? (image.cy - (floor.minY + floor.maxY) / 2) * S : 0;
  return (
    <group position={[cx, y, cz]}>
      <mesh>
        <boxGeometry args={[w, 0.05, d]} />
        <meshStandardMaterial color={floor.color} transparent opacity={0.16} roughness={0.9} />
        <Edges color={floor.color} />
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

function Room({ room, S, gapY, center }) {
  const r = Math.max(0.06, room.r * S);
  const x = (room.x - center.x) * S;
  const z = (room.y - center.y) * S;
  const y = room.rank * gapY + r + 0.06; // sit on the slab
  return (
    <group position={[x, y, z]}>
      <mesh castShadow>
        <sphereGeometry args={[r, 32, 24]} />
        <meshStandardMaterial color={room.color} roughness={0.35} metalness={0.05} />
      </mesh>
      <Html position={[0, r + 0.12, 0]} center distanceFactor={16} occlude={false}>
        <div className="r3f-room-label">{room.name}</div>
      </Html>
    </group>
  );
}

function Scene({ scene, gap, showImage }) {
  const { center, foot, floors, rooms, links, image, floorCount } = scene;
  const S = 14 / Math.max(foot.w, foot.h, 1);
  const gapY = gap * 9;
  const midY = ((floorCount - 1) * gapY) / 2;
  const span = Math.max(foot.w, foot.h) * S;

  const linkLines = useMemo(
    () =>
      links.map((l, i) => {
        const a = new THREE.Vector3((l.a[0] - center.x) * S, l.a[2] * gapY + 0.1, (l.a[1] - center.y) * S);
        const b = new THREE.Vector3((l.b[0] - center.x) * S, l.b[2] * gapY + 0.1, (l.b[1] - center.y) * S);
        const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
        return { key: i, geom, strength: l.strength };
      }),
    [links, center.x, center.y, S, gapY]
  );

  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[8, 18, 10]} intensity={1.1} />
      <directionalLight position={[-10, 8, -6]} intensity={0.35} />

      <OrbitControls target={[0, midY, 0]} enableDamping makeDefault />

      {floors.map((f) => (
        <Floor key={f.label} floor={f} S={S} gapY={gapY} center={center} image={image} showImage={showImage} />
      ))}

      {linkLines.map((l) => (
        <line key={`l${l.key}`} geometry={l.geom}>
          <lineBasicMaterial
            color={l.strength === 'required' ? '#aeb7c9' : '#57c7d4'}
            transparent
            opacity={l.strength === 'required' ? 0.85 : 0.55}
          />
        </line>
      ))}

      {rooms.map((room) => (
        <Room key={room.key} room={room} S={S} gapY={gapY} center={center} />
      ))}

      {/* Vertical corner posts tying the stack together. */}
      {floorCount > 1 &&
        [
          [foot.x0, foot.y0], [foot.x1, foot.y0], [foot.x1, foot.y1], [foot.x0, foot.y1],
        ].map(([px, py], i) => {
          const x = (px - center.x) * S;
          const z = (py - center.y) * S;
          const geom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(x, 0, z),
            new THREE.Vector3(x, (floorCount - 1) * gapY, z),
          ]);
          return (
            <line key={`post${i}`} geometry={geom}>
              <lineBasicMaterial color="#5b6478" transparent opacity={0.5} />
            </line>
          );
        })}

      <gridHelper args={[span * 2.4, 16, '#2c3340', '#1e242f']} position={[0, -0.4, 0]} />
    </>
  );
}

export default function Stacked3D({ scene, gap, showImage }) {
  const S = 14 / Math.max(scene.foot.w, scene.foot.h, 1);
  const span = Math.max(scene.foot.w, scene.foot.h) * S;
  const topY = (scene.floorCount - 1) * (gap * 9);

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
      camera={{ position: [span * 1.1, topY + span * 0.9, span * 1.5], fov: 42 }}
      gl={{ antialias: true }}
      style={{ background: 'transparent' }}
    >
      <Suspense fallback={null}>
        <Scene scene={scene} gap={gap} showImage={showImage} />
      </Suspense>
    </Canvas>
  );
}
