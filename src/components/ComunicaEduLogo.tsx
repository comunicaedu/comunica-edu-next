"use client";

import Image from "next/image";

const ComunicaEduLogo = ({ size = "lg" }: { size?: "sm" | "lg" }) => {
  const logoClass = size === "lg" ? "h-28 md:h-36" : "h-14 md:h-20";

  return (
    <div className="flex items-center justify-center">
      <Image
        src="/logo.jpeg"
        alt="ComunicaEDU"
        width={320}
        height={144}
        priority
        className={`${logoClass} w-auto object-contain`}
        style={{ imageRendering: "crisp-edges" }}
      />
    </div>
  );
};

export default ComunicaEduLogo;