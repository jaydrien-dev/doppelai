"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { RunTheatre } from "@/components/RunTheatre";
import { Pulse } from "@/components/Pulse";

function Inner() {
  const id = useSearchParams().get("id") ?? "";
  return <RunTheatre routineId={id} />;
}

export default function RunPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-dvh place-items-center">
          <Pulse size={120} />
        </div>
      }
    >
      <Inner />
    </Suspense>
  );
}
