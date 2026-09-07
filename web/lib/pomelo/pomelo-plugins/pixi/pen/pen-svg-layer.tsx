import { useRef, useState } from 'react';
import { PixiRendererAdapter, Point, stageToCanvas, Transform, useEditorContext, windowToCanvas } from '../../../pomelo-core';
import { smoothPathToSVG } from './pen-utils';

interface SvgLayerProps {
  color: string;
  width: number;
  onPathComplete: (points: Point[]) => void;
}

export function SvgLayer({ color, width, onPathComplete }: SvgLayerProps) {
  const editor = useEditorContext();
  const adapter = editor.renderAdapter as PixiRendererAdapter;
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<Point[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    setIsDrawing(true);
    const point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    setCurrentPath([point]);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawing) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    const point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    setCurrentPath(prev => [...prev, point]);
  };

  const handlePointerUp = () => {
    setIsDrawing(false);
    if (currentPath.length > 0) {
      onPathComplete(transformPathToCanvas(currentPath, adapter.transform));
      setCurrentPath([]);
    }
  };

  return (
    <svg
      ref={svgRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        opacity: 0.6,
        width: '100%',
        height: '100%',
        pointerEvents: 'all',
        overflow: 'visible',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {currentPath.length >= 2 && (
        <path
          d={smoothPathToSVG(currentPath)}
          stroke={color}
          strokeWidth={width * adapter.transform.scale}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export function transformPathToCanvas(
  points: Point[],
  transform: Transform
): Point[] {
  return points.map(point => {
    return stageToCanvas(point, transform)
  }
  );
}