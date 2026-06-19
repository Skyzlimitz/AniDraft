import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
// Validates the environment at build/boot — fails fast on missing vars.
import "@/lib/env";
import { UserMenu } from "@/components/auth/UserMenu";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AniDraft — Anime Fantasy Draft League",
  description:
    "Draft your favorite currently-airing anime and compete with friends in a fantasy league.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark`}
    >
      <body className="antialiased">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
          <Link href="/" className="font-bold tracking-tight">
            Ani<span className="text-primary">Draft</span>
          </Link>
          <UserMenu />
        </header>
        {children}
      </body>
    </html>
  );
}
