"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, ChevronRight, ChevronLeft, Sparkles } from "lucide-react";

export interface TourStep {
  /** CSS selector for the target element to highlight */
  target?: string;
  /** Popover title */
  title: string;
  /** Popover description */
  description: string;
  /** Position of popover relative to target */
  position?: "top" | "bottom" | "left" | "right";
  /** Called before this step renders — use for navigation, tab switches, typing, etc. */
  beforeStep?: () => void | Promise<void>;
  /** Called after user clicks "Next" on this step */
  afterStep?: () => void | Promise<void>;
  /** If true, add a small delay after beforeStep to let the DOM update */
  waitForDom?: boolean;
}

export interface TourDefinition {
  key: string;
  name: string;
  steps: TourStep[];
}

interface TourEngineProps {
  tour: TourDefinition;
  onComplete: () => void;
  onSkip: () => void;
}

export default function TourEngine({ tour, onComplete, onSkip }: TourEngineProps) {
  const [stepIndex, setStepIndex] = useState(-1); // -1 = welcome screen
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const step = stepIndex >= 0 && stepIndex < tour.steps.length ? tour.steps[stepIndex] : null;
  const isWelcome = stepIndex === -1;
  const isLastStep = stepIndex === tour.steps.length - 1;

  // Find and highlight the target element
  const updateTarget = useCallback(() => {
    if (!step?.target) {
      setTargetRect(null);
      setReady(true);
      return;
    }
    const el = document.querySelector(step.target);
    if (el) {
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);
      // Scroll into view if needed
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setReady(true);
    } else {
      setTargetRect(null);
      setReady(true);
    }
  }, [step]);

  // Run beforeStep and update target when step changes
  useEffect(() => {
    if (stepIndex < 0) {
      setReady(true);
      return;
    }
    if (!step) return;

    setReady(false);
    const run = async () => {
      if (step.beforeStep) {
        await step.beforeStep();
      }
      if (step.waitForDom) {
        // Wait for DOM to update after navigation
        await new Promise((r) => setTimeout(r, 300));
      }
      updateTarget();
    };
    run();
  }, [stepIndex, step, updateTarget]);

  // Update target rect on resize/scroll
  useEffect(() => {
    if (!ready || !step?.target) return;
    const handler = () => updateTarget();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [ready, step, updateTarget]);

  const goNext = useCallback(async () => {
    if (step?.afterStep) await step.afterStep();
    if (isLastStep) {
      onComplete();
    } else {
      setStepIndex((i) => i + 1);
    }
  }, [step, isLastStep, onComplete]);

  const goPrev = useCallback(() => {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  }, [stepIndex]);

  const startTour = () => setStepIndex(0);

  // Compute popover position
  const getPopoverStyle = (): React.CSSProperties => {
    if (!targetRect || !step) {
      // Center on screen (for welcome or no-target steps)
      return {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };
    }

    const pos = step.position ?? "bottom";
    const pad = 16;
    const clampLeft = (x: number) => Math.max(16, Math.min(x, window.innerWidth - 360));
    const clampTop = (y: number) => Math.max(16, Math.min(y, window.innerHeight - 200));

    switch (pos) {
      case "bottom":
        return {
          position: "fixed",
          top: clampTop(targetRect.bottom + pad),
          left: clampLeft(targetRect.left + targetRect.width / 2 - 160),
        };
      case "top":
        return {
          position: "fixed",
          top: clampTop(Math.max(16, targetRect.top - pad - 180)),
          left: clampLeft(targetRect.left + targetRect.width / 2 - 160),
        };
      case "right":
        return {
          position: "fixed",
          top: clampTop(targetRect.top + targetRect.height / 2 - 60),
          left: clampLeft(targetRect.right + pad),
        };
      case "left":
        return {
          position: "fixed",
          top: clampTop(targetRect.top + targetRect.height / 2 - 60),
          right: Math.max(16, window.innerWidth - targetRect.left + pad),
        };
    }
  };

  // Highlight cutout SVG path
  const getCutoutPath = (): string => {
    if (!targetRect) return "";
    const p = 6; // padding around element
    const r = 10; // border radius
    const x = targetRect.left - p;
    const y = targetRect.top - p;
    const w = targetRect.width + p * 2;
    const h = targetRect.height + p * 2;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Full screen rect with a rounded-rect hole cut out
    return `M0,0 L${vw},0 L${vw},${vh} L0,${vh} Z
            M${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r}
            L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h}
            L${x + r},${y + h} Q${x},${y + h} ${x},${y + h - r}
            L${x},${y + r} Q${x},${y} ${x + r},${y} Z`;
  };

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* Backdrop with cutout */}
      <svg className="fixed inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        <path
          d={targetRect ? getCutoutPath() : `M0,0 L${window.innerWidth},0 L${window.innerWidth},${window.innerHeight} L0,${window.innerHeight} Z`}
          fill="rgba(30, 35, 50, 0.55)"
          fillRule="evenodd"
        />
      </svg>

      {/* Click blocker (except the highlighted area) */}
      <div className="fixed inset-0" onClick={(e) => e.stopPropagation()} />

      {/* Welcome screen */}
      {isWelcome && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 10 }}>
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full mx-4 shadow-xl fade-up" style={{ boxShadow: "0 8px 40px rgba(45, 49, 66, 0.15)" }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl mint-gradient flex items-center justify-center" style={{ boxShadow: "0 4px 14px rgba(51, 178, 156, 0.25)" }}>
                <Sparkles size={18} className="text-white" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-[var(--text)]">{tour.name}</h2>
                <p className="text-xs text-[var(--text-muted)]">{tour.steps.length} steps</p>
              </div>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-6 leading-relaxed">
              Let us show you around the new features. This quick tour will walk you through everything you need to know.
            </p>
            <div className="flex gap-3">
              <button onClick={onSkip} className="flex-1 px-4 py-2.5 text-sm font-medium text-[var(--text-muted)] rounded-xl border border-[var(--border)] hover:bg-[var(--bg-warm)] transition-colors">
                Skip tour
              </button>
              <button onClick={startTour} className="flex-1 px-4 py-2.5 text-sm font-bold text-white rounded-xl mint-gradient hover:opacity-90 transition-opacity" style={{ boxShadow: "0 4px 14px rgba(51, 178, 156, 0.25)" }}>
                Start tour
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step popover */}
      {step && ready && (
        <div ref={popoverRef} style={{ ...getPopoverStyle(), zIndex: 10, maxWidth: 340 }} className="fade-up">
          <div className="bg-white rounded-xl p-5 shadow-xl border border-[var(--border)]" style={{ boxShadow: "0 8px 32px rgba(45, 49, 66, 0.12)" }}>
            {/* Close */}
            <button onClick={onSkip} className="absolute top-3 right-3 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
              <X size={14} />
            </button>

            {/* Step counter */}
            <div className="flex items-center gap-1.5 mb-2">
              {tour.steps.map((_, i) => (
                <div key={i} className={`h-1 rounded-full transition-all ${i === stepIndex ? "w-5 bg-[var(--mint)]" : i < stepIndex ? "w-2 bg-[var(--mint-light)]" : "w-2 bg-[var(--border)]"}`} />
              ))}
              <span className="ml-auto text-[10px] text-[var(--text-muted)]">{stepIndex + 1}/{tour.steps.length}</span>
            </div>

            <h3 className="font-display font-bold text-sm text-[var(--text)] mb-1">{step.title}</h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-4">{step.description}</p>

            {/* Navigation */}
            <div className="flex items-center gap-2">
              {stepIndex > 0 && (
                <button onClick={goPrev} className="px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] rounded-lg border border-[var(--border)] hover:bg-[var(--bg-warm)] transition-colors flex items-center gap-1">
                  <ChevronLeft size={12} /> Back
                </button>
              )}
              <button onClick={goNext} className="ml-auto px-4 py-1.5 text-xs font-bold text-white rounded-lg mint-gradient hover:opacity-90 transition-opacity flex items-center gap-1" style={{ boxShadow: "0 2px 8px rgba(51, 178, 156, 0.2)" }}>
                {isLastStep ? "Done" : "Next"} {!isLastStep && <ChevronRight size={12} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
