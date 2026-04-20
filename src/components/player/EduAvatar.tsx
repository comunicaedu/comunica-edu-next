"use client";

// Avatar EDU — careca limpo, barba cheia escura, pele morena, sorriso enorme
// SEM fone de ouvido, SEM sombra escura no topo
const EduAvatar = ({ size = 60, eyeOffset = { x: 0, y: 0 } }: { size?: number; eyeOffset?: { x: number; y: number } }) => {
  const px = Math.max(-3, Math.min(3, eyeOffset.x));
  const py = Math.max(-3, Math.min(3, eyeOffset.y));

  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Cabeça — moreno claro */}
      <ellipse cx="60" cy="62" rx="36" ry="40" fill="#C68A5E"/>

      {/* Brilho careca — suave, claro */}
      <ellipse cx="50" cy="35" rx="10" ry="5" fill="#D9A47A" opacity="0.4" transform="rotate(-15 50 35)"/>

      {/* Orelhas */}
      <ellipse cx="24" cy="63" rx="6" ry="9" fill="#C68A5E"/>
      <ellipse cx="96" cy="63" rx="6" ry="9" fill="#C68A5E"/>
      <ellipse cx="24" cy="63" rx="3" ry="5" fill="#A0673A"/>
      <ellipse cx="96" cy="63" rx="3" ry="5" fill="#A0673A"/>

      {/* Sobrancelhas levantadas (empolgado) */}
      <path d="M36 49 Q44 43 52 47" stroke="#1a0800" strokeWidth="3.2" strokeLinecap="round" fill="none"/>
      <path d="M68 47 Q76 43 84 49" stroke="#1a0800" strokeWidth="3.2" strokeLinecap="round" fill="none"/>

      {/* Olhos brancos */}
      <ellipse cx="44" cy="59" rx="7" ry="7.5" fill="white"/>
      <ellipse cx="76" cy="59" rx="7" ry="7.5" fill="white"/>
      {/* Íris seguindo cursor */}
      <circle cx={44 + px} cy={59 + py} r="4.8" fill="#0f0700"/>
      <circle cx={76 + px} cy={59 + py} r="4.8" fill="#0f0700"/>
      {/* Brilho */}
      <circle cx={46 + px} cy={57 + py} r="1.6" fill="white"/>
      <circle cx={78 + px} cy={57 + py} r="1.6" fill="white"/>

      {/* Nariz */}
      <ellipse cx="60" cy="70" rx="3.5" ry="2.5" fill="#A0673A"/>

      {/* Sorriso enorme */}
      <path d="M37 79 Q60 102 83 79" fill="#1a0800"/>
      <path d="M39 79 Q60 98 81 79 Q60 90 39 79Z" fill="white"/>
      <line x1="60" y1="79" x2="60" y2="89" stroke="#ddd" strokeWidth="1"/>
      <line x1="50" y1="79.5" x2="49" y2="88" stroke="#ddd" strokeWidth="1"/>
      <line x1="70" y1="79.5" x2="71" y2="88" stroke="#ddd" strokeWidth="1"/>

      {/* Barba cheia escura */}
      <path d="M27 78 Q29 106 60 112 Q91 106 93 78 Q77 90 60 92 Q43 90 27 78Z" fill="#0f0700"/>
      <path d="M38 84 Q60 94 82 84" stroke="#2a1500" strokeWidth="1.5" fill="none" opacity="0.45"/>
      <path d="M33 92 Q60 103 87 92" stroke="#2a1500" strokeWidth="1.5" fill="none" opacity="0.3"/>

      {/* Blush empolgação */}
      <ellipse cx="28" cy="72" rx="7" ry="3.5" fill="#e07050" opacity="0.25"/>
      <ellipse cx="92" cy="72" rx="7" ry="3.5" fill="#e07050" opacity="0.25"/>
    </svg>
  );
};

export default EduAvatar;
