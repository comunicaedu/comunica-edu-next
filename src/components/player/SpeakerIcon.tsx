"use client";

const SpeakerIcon = ({ size = 20, className = "" }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
  >
    <path
      d="M11 5L6 9H2v6h4l5 4V5z"
      fill="currentColor"
      opacity="0.9"
    />
    <path
      d="M15.54 8.46a5 5 0 0 1 0 7.07"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-pulse"
    />
    <path
      d="M19.07 4.93a10 10 0 0 1 0 14.14"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-pulse"
      style={{ animationDelay: "0.15s" }}
    />
  </svg>
);

export default SpeakerIcon;