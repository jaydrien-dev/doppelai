"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

/** A calm, centred panel. Soft fade, no bounce, click-away to dismiss. */
export function Modal({
  open,
  onClose,
  children,
  width = 520,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  dismissable?: boolean;
}) {
  useEffect(() => {
    if (!open || !dismissable) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, dismissable]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] grid place-items-center px-6 py-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
          style={{ background: "var(--scrim)", backdropFilter: "blur(3px)" }}
          onClick={() => dismissable && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.995 }}
            transition={{ duration: 0.34, ease: [0.22, 0.61, 0.36, 1] }}
            className="max-h-full w-full overflow-y-auto"
            style={{
              maxWidth: width,
              background: "var(--surface)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--elev-raised-lg)",
              padding: 36,
            }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
