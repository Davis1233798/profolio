import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TableCraft · 店長管理 (營收KPI與菜單定價) | 智慧餐飲系統",
  description: "餐廳經理與營運總監：日營業額KPI即時看板、菜單定價與售罄調控、出餐超時SLA監控。",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
