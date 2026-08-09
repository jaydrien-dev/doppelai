"use client";

/**
 * Pocket rendered inside a device, so the phone and the desk can be demoed
 * side by side. In the Electron Pocket window the frame is dropped — the OS
 * window is already the device.
 */
export function PhoneFrame({ children, bare }: { children: React.ReactNode; bare: boolean }) {
  if (bare) {
    return (
      <div
        className="mx-auto min-h-dvh w-full"
        style={{ maxWidth: 460, background: "var(--bg-base)" }}
      >
        {children}
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center px-6 py-12">
      <div
        style={{
          width: 392,
          maxWidth: "100%",
          height: 812,
          maxHeight: "88dvh",
          padding: 12,
          borderRadius: 48,
          background: "var(--bg-base)",
          boxShadow: "var(--elev-raised-lg)",
        }}
      >
        <div
          className="relative h-full w-full overflow-y-auto"
          style={{
            borderRadius: 38,
            background: "var(--surface)",
            boxShadow: "var(--elev-pressed)",
          }}
        >
          {/* the speaker slot, because the shape needs one */}
          <div
            aria-hidden
            className="sticky top-0 z-20 flex justify-center pt-3"
            style={{ background: "var(--surface)" }}
          >
            <span
              className="block"
              style={{
                width: 54,
                height: 5,
                borderRadius: "var(--radius-pill)",
                background: "var(--bg-base)",
                boxShadow: "var(--elev-pressed-sm)",
              }}
            />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
