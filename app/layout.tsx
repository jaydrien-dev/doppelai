import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { Motion } from "@/components/Motion";

const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mimic",
  description: "It watches how you work, learns the repeats, and takes them over.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={figtree.variable}>
      <body>
        <Motion>
          <Shell>{children}</Shell>
        </Motion>
      </body>
    </html>
  );
}
