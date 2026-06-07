import { useEffect, useRef, useState } from "react";

const AnimatedSpan = ({
  children,
  delay = 0,
  animateBy = "words",
  direction = "top",
  threshold = 0.1,
  rootMargin = "0px",
  animationFrom,
  animationTo,
  easing = "cubic-bezier(0.215, 0.61, 0.355, 1)",
  onAnimationComplete,
}: {
  children: React.ReactNode;
  delay?: number;
  animateBy?: "words" | "letters";
  direction?: "top" | "bottom" | "left" | "right";
  threshold?: number;
  rootMargin?: string;
  animationFrom?: Record<string, string | number>;
  animationTo?: Record<string, string | number>[];
  easing?: string;
  onAnimationComplete?: () => void;
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            setIsVisible(true);
            onAnimationComplete?.();
          }, delay);
        }
      },
      { threshold, rootMargin }
    );

    if (spanRef.current) {
      observer.observe(spanRef.current);
    }

    return () => observer.disconnect();
  }, [threshold, rootMargin, delay, onAnimationComplete]);

  const directionOffset = {
    top: [0, -45],
    bottom: [0, 45],
    left: [-45, 0],
    right: [45, 0],
  };

  const defaultFrom = animationFrom ?? {
    opacity: 0,
    filter: "blur(12px)",
    transform: `translate3d(0, ${directionOffset[direction][1]}px, 0)`,
  };

  const defaultTo = animationTo ?? [
    {
      opacity: 1,
      filter: "blur(0px)",
      transform: "translate3d(0, 0, 0)",
    },
  ];

  return (
    <span
      ref={spanRef}
      style={{
        display: "inline-block",
        willChange: "transform, opacity, filter",
        transition: `all 800ms ${easing}`,
        ...(isVisible ? defaultTo[0] : defaultFrom),
      }}
    >
      {children}
    </span>
  );
};

export const BlurText = ({
  text,
  delay = 200,
  className = "",
  animateBy = "words",
  direction = "top",
  threshold = 0.1,
  rootMargin = "0px",
  animationFrom,
  animationTo,
  easing = "cubic-bezier(0.215, 0.61, 0.355, 1)",
  onAnimationComplete,
}: {
  text: string;
  delay?: number;
  className?: string;
  animateBy?: "words" | "letters";
  direction?: "top" | "bottom" | "left" | "right";
  threshold?: number;
  rootMargin?: string;
  animationFrom?: Record<string, string | number>;
  animationTo?: Record<string, string | number>[];
  easing?: string;
  onAnimationComplete?: () => void;
}) => {
  const elements = animateBy === "words" ? text.split(" ") : text.split("");
  const [completedCount, setCompletedCount] = useState(0);

  const handleAnimationComplete = () => {
    setCompletedCount((prev) => prev + 1);
    if (completedCount + 1 === elements.length) {
      onAnimationComplete?.();
    }
  };

  return (
    <span className={className} aria-label={text}>
      {elements.map((element, index) => (
        <AnimatedSpan
          key={index}
          delay={delay * index}
          animateBy={animateBy}
          direction={direction}
          threshold={threshold}
          rootMargin={rootMargin}
          animationFrom={animationFrom}
          animationTo={animationTo}
          easing={easing}
          onAnimationComplete={handleAnimationComplete}
        >
          {element === " " ? "\u00A0" : element}
          {animateBy === "words" && index < elements.length - 1 ? "\u00A0" : ""}
        </AnimatedSpan>
      ))}
    </span>
  );
};
