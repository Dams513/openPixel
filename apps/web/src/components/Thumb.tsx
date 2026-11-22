import { useEffect, useRef } from 'react';
import { compositePacked, packedToBytes, type Doc } from '@openpixel/core';

/** Small preview of one frame (optionally a single layer). */
export function Thumb({ doc, version, frame, layerId, size = 40 }: { doc: Doc; version: number; frame: number; layerId?: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const c = ref.current;
      if (!c) return;
      c.width = doc.width;
      c.height = doc.height;
      const packed = compositePacked(doc, { frame, layerIds: layerId ? [layerId] : undefined, includeHidden: !!layerId });
      c.getContext('2d')!.putImageData(new ImageData(packedToBytes(packed) as Uint8ClampedArray<ArrayBuffer>, doc.width, doc.height), 0, 0);
    }, 60);
    return () => clearTimeout(t);
  }, [doc, version, frame, layerId]);
  const ar = doc.width / doc.height;
  const w = ar >= 1 ? size : Math.round(size * ar);
  const h = ar >= 1 ? Math.round(size / ar) : size;
  return (
    <span className="thumb" style={{ width: size, height: size }}>
      <canvas ref={ref} style={{ width: w, height: h }} />
    </span>
  );
}
