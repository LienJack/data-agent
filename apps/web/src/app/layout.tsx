import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./design-system.css";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "Data Agent — 分析工作台",
  description: "L2 多步研究分析师 · 强 Text2SQL · 评测闭环 · 语义治理",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
