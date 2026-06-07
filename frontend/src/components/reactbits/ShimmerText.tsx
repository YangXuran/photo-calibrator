export const ShimmerText = ({
  text,
  shimmerColor = "var(--color-accent, #a78bfa)",
  className = "",
  duration = "2s",
}: {
  text: string;
  shimmerColor?: string;
  className?: string;
  duration?: string;
}) => {
  return (
    <span
      className={className}
      style={{
        display: "inline-block",
        background: `linear-gradient(
          110deg,
          var(--color-text-secondary, #94a3b8) 0%,
          var(--color-text-secondary, #94a3b8) 40%,
          ${shimmerColor} 50%,
          var(--color-text-secondary, #94a3b8) 60%,
          var(--color-text-secondary, #94a3b8) 100%
        )`,
        backgroundSize: "200% 100%",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
        animation: `pc-shimmer ${duration} linear infinite`,
      }}
    >
      {text}
      <style>{`
        @keyframes pc-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </span>
  );
};
