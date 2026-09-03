import { useEffect, useState } from "react";
import { GalleryPage } from "./components/GalleryPage";
import { DetailPage } from "./components/DetailPage";
import { getEffect } from "./catalog";

function useHashRoute(): { effectId: string | null } {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const match = hash.match(/^#\/effect\/(.+)$/);
  return { effectId: match ? decodeURIComponent(match[1]) : null };
}

export function App() {
  const { effectId } = useHashRoute();
  const effect = effectId ? getEffect(effectId) : undefined;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [effectId]);
  if (effectId && !effect) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-white/50">
        未找到效果: {effectId}
      </div>
    );
  }
  return effect ? <DetailPage effect={effect} /> : <GalleryPage />;
}
