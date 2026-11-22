"use client";

import Link from "next/link";
import { usePortfolioLocale } from "@/components/portfolio-experience";
import { Smartphone, Armchair, ChefHat, LayoutDashboard, Building2, ArrowLeft, ExternalLink, CheckCircle } from "lucide-react";

export function DiningRoleNav({ currentRole }: { currentRole: "customer" | "front" | "back" | "admin" | "franchise" }) {
  const { t } = usePortfolioLocale();

  const roles = [
    {
      id: "customer" as const,
      href: "/dining/customer",
      nameZh: "用戶端點餐",
      nameEn: "Customer",
      roleZh: "顧客桌邊手機掃碼點餐 (純顧客端 RWA / 無內部權限)",
      icon: Smartphone,
      activeColor: "border-rose-600 bg-rose-50 dark:bg-rose-950/40 text-rose-950 dark:text-rose-100 ring-2 ring-rose-500",
      accentBg: "bg-rose-600 text-white",
      badgeText: "顧客 RWA",
    },
    {
      id: "front" as const,
      href: "/dining/front",
      nameZh: "前台外場收銀",
      nameEn: "Front Office",
      roleZh: "外場服務員 / 領檯收銀 / 預約開桌",
      icon: Armchair,
      activeColor: "border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-950 dark:text-blue-100 ring-2 ring-blue-500",
      accentBg: "bg-blue-600 text-white",
      badgeText: "外場現場",
    },
    {
      id: "back" as const,
      href: "/dining/back",
      nameZh: "後台廚房出餐",
      nameEn: "Back Office",
      roleZh: "主廚 KDS / 出餐進度 / 結帳拆單",
      icon: ChefHat,
      activeColor: "border-amber-600 bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100 ring-2 ring-amber-500",
      accentBg: "bg-amber-600 text-white",
      badgeText: "廚房 KDS",
    },
    {
      id: "admin" as const,
      href: "/dining/admin",
      nameZh: "店長營運管理",
      nameEn: "Manager",
      roleZh: "餐廳店經理 / 營收KPI / 菜單定價",
      icon: LayoutDashboard,
      activeColor: "border-purple-600 bg-purple-50 dark:bg-purple-950/40 text-purple-950 dark:text-purple-100 ring-2 ring-purple-500",
      accentBg: "bg-purple-600 text-white",
      badgeText: "營運管理",
    },
    {
      id: "franchise" as const,
      href: "/dining/franchise",
      nameZh: "連鎖門市加盟主",
      nameEn: "Franchise",
      roleZh: "連鎖加盟門市投資主 / 央廚叫貨",
      icon: Building2,
      activeColor: "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-100 ring-2 ring-emerald-500",
      accentBg: "bg-emerald-600 text-white",
      badgeText: "加盟投資",
    },
  ];

  const currentRoleInfo = roles.find((r) => r.id === currentRole) || roles[0];

  return (
    <nav
      aria-label="智慧餐飲五大專屬角色獨立分頁"
      className="mb-6 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs space-y-3"
    >
      {/* Header bar: Explains current dedicated URL and tab opening policy */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 dark:border-stone-800 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-black tracking-wide text-stone-900 dark:text-stone-100">
            {t("SMART DINING INDEPENDENT SUBSYSTEMS", "智慧餐飲 · 門市營運四大控制台與顧客端 RWA")}
          </span>
          <span className="rounded-md bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-[11px] font-mono font-semibold text-stone-700 dark:text-stone-300 border border-stone-200 dark:border-stone-700">
            目前所在獨立路由：<strong className="text-primary font-bold">{currentRoleInfo.href}</strong>
          </span>
          <span className="rounded-md bg-emerald-100 dark:bg-emerald-950/70 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            ● 獨立網址 · 獨立分頁
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-[11px] text-stone-500 dark:text-stone-400 font-medium">
            點選其他角色立即以「全新瀏覽器分頁 (New Tab)」跳轉開啟
          </span>
          <Link
            href="/#work"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-bold text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white transition"
          >
            <ArrowLeft size={13} />
            <span>返回作品集 ↗</span>
          </Link>
        </div>
      </div>

      {/* Grid of 5 Subsystems */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
        {roles.map((r) => {
          const Icon = r.icon;
          const isActive = currentRole === r.id;

          return (
            <a
              key={r.id}
              href={r.href}
              target={isActive ? undefined : "_blank"}
              rel={isActive ? undefined : "noopener noreferrer"}
              onClick={(e) => {
                if (isActive) {
                  e.preventDefault();
                } else {
                  e.preventDefault();
                  window.open(r.href, "_blank", "noopener,noreferrer");
                }
              }}
              title={isActive ? `目前所在專屬頁面 (${r.href})` : `以全新瀏覽器分頁跳轉開啟 ${r.nameZh} (${r.href})`}
              className={`flex flex-col justify-between p-3.5 rounded-xl border transition text-left no-underline select-none ${
                isActive
                  ? `${r.activeColor} shadow-sm`
                  : "border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-950/40 hover:bg-white dark:hover:bg-stone-800 hover:border-stone-400 dark:hover:border-stone-600 hover:shadow-xs cursor-pointer group"
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`p-1.5 rounded-lg ${isActive ? r.accentBg : "bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-300 group-hover:bg-primary group-hover:text-white transition"}`}>
                      <Icon size={16} />
                    </span>
                    <span className="font-black text-sm text-stone-900 dark:text-stone-100">
                      {r.nameZh}
                    </span>
                  </div>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    isActive ? "bg-stone-900/10 dark:bg-white/20 text-stone-900 dark:text-white" : "bg-stone-200 dark:bg-stone-800 text-stone-600 dark:text-stone-400"
                  }`}>
                    {r.badgeText}
                  </span>
                </div>

                <p className={`text-xs leading-snug line-clamp-2 mt-1 ${isActive ? "text-stone-800 dark:text-stone-200 font-semibold" : "text-stone-600 dark:text-stone-400"}`}>
                  {r.roleZh}
                </p>
              </div>

              {/* Status / Call to action */}
              <div className="mt-3 pt-2 border-t border-stone-200/50 dark:border-stone-800/80 flex items-center justify-between text-[11px]">
                {isActive ? (
                  <span className="inline-flex items-center gap-1 font-bold text-emerald-700 dark:text-emerald-400">
                    <CheckCircle size={13} />
                    <span>目前獨立分頁 (運行中)</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-bold text-primary group-hover:underline">
                    <span>{r.id === "customer" ? "新分頁開啟顧客點餐" : "新分頁開啟系統"}</span>
                    <ExternalLink size={12} />
                  </span>
                )}
                <span className="font-mono text-[10px] text-stone-400 dark:text-stone-500">
                  {r.href}
                </span>
              </div>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
