import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TableCraft · 後台廚房 (KDS出餐與退菜結帳) | 智慧餐飲系統",
  description: "廚房主廚出餐看板：熱炒/冷盤/飲品工作站分流、急單催單優先標記、AA制拆帳與退菜核銷。",
};

export default function BackLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
