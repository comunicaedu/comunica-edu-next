"use client";

const eduLogoIcon = "/edu-logo-icon.png";

const EduLogoIcon = ({ size = 24, fillContainer = false }: { size?: number; fillContainer?: boolean }) => {
  return (
    <img
      src={eduLogoIcon}
      alt="EDU"
      width={size}
      height={size}
      className={fillContainer ? "object-cover w-full h-full" : "object-contain"}
      style={fillContainer ? { width: "100%", height: "100%" } : { width: size, height: size }}
    />
  );
};

export default EduLogoIcon;