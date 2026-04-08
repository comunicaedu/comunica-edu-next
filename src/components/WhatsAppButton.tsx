"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

const WHATSAPP_PHONE = "5591984255650";
const WHATSAPP_WA_URL = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent("Olá! Quero saber mais sobre o ComunicaEdu")}`;

const GHOST_OPACITY = 0.10;
const DRAG_THRESHOLD = 5;

const clampPosition = (x: number, y: number, w: number, h: number) => ({
  x: Math.max(4, Math.min(window.innerWidth - w - 4, x)),
  y: Math.max(4, Math.min(window.innerHeight - h - 4, y)),
});

const WhatsAppButton = () => {
  const isMobile = useIsMobile();
  const btnW = isMobile ? 40 : 90;
  const btnH = isMobile ? 40 : 30;

  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const offset = useRef({ x: 0, y: 0 });
  const startPos = useRef({ x: 0, y: 0 });
  const movedDuringDrag = useRef(false);
  const btnRef = useRef<HTMLAnchorElement>(null);

  // Initialize position client-side only (avoids SSR crash)
  useEffect(() => {
    const saved = localStorage.getItem("whatsapp-ghost-pos");
    if (saved) {
      try {
        const p = JSON.parse(saved);
        setPosition(clampPosition(p.x, p.y, btnW, btnH));
        setMounted(true);
        return;
      } catch { /* fallback */ }
    }
    setPosition({ x: window.innerWidth - btnW - 12, y: window.innerHeight - btnH - 16 });
    setMounted(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toggle with W key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== "w" && e.key !== "W") return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      setVisible((v) => !v);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Clamp on resize
  useEffect(() => {
    const handleResize = () => setPosition((p) => clampPosition(p.x, p.y, btnW, btnH));
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [btnW, btnH]);

  // Pointer down starts drag on both desktop and mobile
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLAnchorElement>) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startPos.current = { x: e.clientX, y: e.clientY };
    movedDuringDrag.current = false;
    offset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    setDragging(true);
  }, [position]);

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: PointerEvent) => {
      const dx = Math.abs(e.clientX - startPos.current.x);
      const dy = Math.abs(e.clientY - startPos.current.y);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        movedDuringDrag.current = true;
        setPosition(clampPosition(e.clientX - offset.current.x, e.clientY - offset.current.y, btnW, btnH));
      }
    };

    const handleUp = () => {
      setDragging(false);
      setPosition((pos) => {
        localStorage.setItem("whatsapp-ghost-pos", JSON.stringify(pos));
        return pos;
      });
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [dragging, btnW, btnH]);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (movedDuringDrag.current) {
      movedDuringDrag.current = false;
      e.preventDefault();
    }
  };

  if (!mounted || !visible) return null;

  const isActive = hovered || dragging;

  return (
    <a
      ref={btnRef}
      href={WHATSAPP_WA_URL}
      target="_blank"
      rel="noopener noreferrer"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      className="fixed z-50 flex items-center rounded-full shadow-lg select-none touch-none"
      style={{
        left: position.x,
        top: position.y,
        backgroundColor: "rgba(37, 211, 102, 0.85)",
        backdropFilter: "blur(4px)",
        opacity: isActive ? 1 : GHOST_OPACITY,
        cursor: dragging ? "grabbing" : "pointer",
        transition: "opacity 0.2s ease-out",
        ...(isMobile
          ? { width: 40, height: 40, justifyContent: "center" }
          : { gap: 6, paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6 }),
      }}
      aria-label="Abrir suporte no WhatsApp"
      title="Suporte via WhatsApp"
    >
      <svg viewBox="0 0 24 24" className="fill-white" style={{ width: isMobile ? 20 : 16, height: isMobile ? 20 : 16, flexShrink: 0 }}>
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
      {!isMobile && <span className="text-white text-[11px] font-medium whitespace-nowrap">Suporte</span>}
    </a>
  );
};

export default WhatsAppButton;
