import type { Metadata } from "next";
import { Saira_Stencil, Chivo, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const display = Saira_Stencil({ subsets: ["latin"], weight: "700", variable: "--ff-display" });
const body = Chivo({ subsets: ["latin"], variable: "--ff-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--ff-mono" });

export const metadata: Metadata = {
  title: "Blast Door | QA sweeps inside sealed sandboxes",
  description: "A browser agent QA-sweeps any web app inside throwaway Docker sandboxes on a Vultr VM, with a vision judge, an adversary, and receipts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <header className="rail" role="banner">
          <Link href="/" className="mark" aria-label="Blast Door home">
            <span className="mark-door" aria-hidden="true" />
            BLAST DOOR
          </Link>
          <nav aria-label="Primary">
            <Link href="/">Bay</Link>
            <Link href="/runs">Run log</Link>
          </nav>
          <span className="rail-tag">VULTR EWR / VC2-2C-4GB / SANDBOX NET BD0</span>
        </header>
        <main id="main">{children}</main>
        <footer className="foot">
          <span>Every model call: Vultr Serverless Inference.</span>
          <span>Every browser: a throwaway container, destroyed after use.</span>
        </footer>
      </body>
    </html>
  );
}
