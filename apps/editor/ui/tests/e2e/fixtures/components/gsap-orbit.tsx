import { useRef } from "@recut/runtime";
import { useTimeline, THREE } from "@recut/runtime";

/**
 * GSAP 旋转立方体（r3f surface，函数组件形态）：useTimeline 目标为 Object3D ref。
 * GSAP 直接 tween mesh.rotation / mesh.position / mesh.scale，R3F 只读当前值渲染。
 */
function GsapOrbit({ color = "#6366f1" }: { color?: string }) {
  const box = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  useTimeline((tl) => {
    if (!box.current || !ring.current) return;
    tl.to(box.current.rotation, { y: Math.PI * 2, duration: 2, ease: "none" }, 0)
      .to(ring.current.rotation, { z: Math.PI * 2, duration: 3, ease: "none" }, 0)
      .fromTo(
        box.current.position,
        { y: -60 },
        { y: 0, duration: 0.8, ease: "bounce.out" },
        0,
      )
      .fromTo(
        box.current.scale,
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 1, duration: 0.5, ease: "back.out(2)" },
        0.1,
      );
  }, []);
  return (
    <group>
      <mesh ref={ring}>
        <torusGeometry args={[1.6, 0.06, 16, 48]} />
        <meshStandardMaterial color="#22d3ee" />
      </mesh>
      <mesh ref={box} position={[0, 0, 0]}>
        <boxGeometry args={[0.9, 0.9, 0.9]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

GsapOrbit.inputs = [{ key: "color", type: "color", default: "#6366f1", label: "主色" }];
GsapOrbit.getBaseSize = () => ({ width: 512, height: 512 });

export default GsapOrbit;