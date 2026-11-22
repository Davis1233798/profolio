import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TableCraft · 連鎖門市加盟主 (門市損益與央廚叫貨) | 智慧餐飲系統",
  description: "連鎖加盟門市投資主入口：多門市營收分潤對帳、總部中央廚房原料低溫叫貨、食品安全與QSC評鑑稽核。",
};

export default function FranchiseLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
