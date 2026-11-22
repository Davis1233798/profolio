import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TableCraft · 顧客點餐 (用戶端 RWA/PWA) | 智慧餐飲系統",
  description: "手機掃碼點餐、尊榮會員卡面、專屬優惠券匣、即時出餐追蹤與促銷優惠推播。",
};

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
