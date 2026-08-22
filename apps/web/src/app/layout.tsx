import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import "./globals.css";
import "./design-system.css";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "Data Agent — 分析工作台",
  description: "L2 多步研究分析师 · 强 Text2SQL · 评测闭环 · 语义治理",
};

const themeBootScript = `try{const mode=localStorage.getItem("data-agent-theme");if(mode==="light"||mode==="dark"){document.documentElement.dataset.theme=mode}}catch{}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <Script id="data-agent-theme" strategy="beforeInteractive">
          {themeBootScript}
        </Script>
      </head>
      <body className="min-h-screen bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
