"use client";

import { useState, useRef, type ReactNode } from "react";

interface DraggableAdjustProps {
  storageKey: string;
  children: ReactNode;
  label?: string;
  absolute?: boolean;
}

const DraggableAdjust = ({ storageKey, children, label, absolute = false }: DraggableAdjustProps) => {
  const [pos, setPos] = useState(() => {
    if (typeof window === 'undefined') return { x: 0, y: 0, s: 1 };
    try { return JSON.parse(localStorage.getItem(storageKey) || '{"x":0,"y":0,"s":1}'); }
    catch { return { x: 0, y: 0, s: 1 }; }
  });
  const dragging = useRef(false);
  const start = useRef({ x: 0, y: 0 });

  const save = (np: typeof pos) => { setPos(np); localStorage.setItem(storageKey, JSON.stringify(np)); };

  return (
    <div
      style={{
        position: absolute ? "absolute" : "relative",
        ...(absolute ? { left: `calc(50% + ${pos.x}px)`, top: `calc(50% + ${pos.y}px)`, transform: `translate(-50%, -50%) scale(${pos.s})` }
          : { transform: `translate(${pos.x}px, ${pos.y}px) scale(${pos.s})` }),
        cursor: dragging.current ? "grabbing" : "grab",
        zIndex: 99,
        userSelect: "none",
      }}
      onMouseDown={(e) => { dragging.current = true; start.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }; e.preventDefault(); }}
      onMouseMove={(e) => { if (!dragging.current) return; save({ ...pos, x: e.clientX - start.current.x, y: e.clientY - start.current.y }); }}
      onMouseUp={() => { dragging.current = false; }}
      onMouseLeave={() => { dragging.current = false; }}
      onWheel={(e) => { e.preventDefault(); save({ ...pos, s: Math.max(0.3, Math.min(3, pos.s + (e.deltaY > 0 ? -0.05 : 0.05))) }); }}
    >
      {children}
      <div
        className="absolute rounded font-mono whitespace-nowrap z-[100]"
        style={{ background: "rgba(0,0,0,0.85)", color: "#4ade80", fontSize: 7, padding: "1px 4px", top: "50%", left: "calc(100% + 4px)", transform: "translateY(-50%)" }}
      >
        {label ? `${label} ` : ""}x:{pos.x.toFixed(0)} y:{pos.y.toFixed(0)} s:{pos.s.toFixed(2)}
      </div>
    </div>
  );
};

export default DraggableAdjust;