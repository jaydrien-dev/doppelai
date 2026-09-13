"use client";

import { Mascot } from "@/components/Mascot";
import { Button } from "@/components/ui";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <Mascot mood="idle" size="lg" />
      <p className="mt-8" style={{ fontSize: "var(--text-display)", fontWeight: 700 }}>
        Something went sideways
      </p>
      <p className="agent-voice mt-4" style={{ color: "var(--slate)", maxWidth: 420 }}>
        {error.message || "An unexpected error occurred. Try refreshing — if it keeps happening, restart the app."}
      </p>
      <Button variant="primary" size="lg" className="mt-8" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}