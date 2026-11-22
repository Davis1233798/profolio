import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TableCraft · 前台現場 (桌況開桌與預約) | 智慧餐飲系統",
  description: "外場服務員與領檯收銀：全場桌況即時圖形化檢視、開桌點餐、90分鐘用餐防衝突預約登記。",
};

export default function FrontLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
