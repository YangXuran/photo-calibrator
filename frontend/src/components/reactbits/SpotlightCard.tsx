import { useRef, useState } from "react";

export const SpotlightCard = ({
  children,
  className = "",
  spotlightColor = "rgba(167, 139, 250, 0.15)",
  disabled = false,
}: {
  children: React.ReactNode;
  className?: string;
  spotlightColor?: string;
  disabled?: boolean;
}) => {
  const divRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!divRef.current || disabled) return;
    const rect = divRef.current.getBoundingClientRect();
    setPosition({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleFocus = () => {
    if (disabled) return;
    setIsFocused(true);
    setOpacity(1);
  };

  const handleBlur = () => {
    setIsFocused(false);
    setOpacity(0);
  };

  const handleMouseEnter = () => {
    if (disabled) return;
    setOpacity(1);
  };

  const handleMouseLeave = () => {
    setOpacity(0);
  };

  return (
    <div
      ref={divRef}
      className={className}
      onMouseMove={handleMouseMove}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        position: "relative",
        borderRadius: "9px",
        overflow: "hidden",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(
            circle at ${position.x}px ${position.y}px,
            ${spotlightColor} 0%,
            transparent 80%
          )`,
          opacity: opacity,
          transition: "opacity 300ms ease",
          pointerEvents: "none",
        }}
      />
      {children}
    </div>
  );
};
