"use client";

import Link from "next/link";
import { usePortfolioLocale } from "@/components/portfolio-experience";
import { Smartphone, Armchair, ChefHat, LayoutDashboard, Building2, ArrowLeft } from "lucide-react";

export function DiningRoleNav({ currentRole }: { currentRole: "customer" | "front" | "back" | "admin" | "franchise" }) {
  const { t } = usePortfolioLocale();

  const roles = [
    {
      id: "customer",
      href: "/dining/customer",
      nameZh: "用戶端",
      nameEn: "Customer",
      roleZh: "顧客手機自選點餐 (RWA/PWA)",
      icon: Smartphone,
      activeColor: "bg-rose-600 text-white shadow-md ring-2 ring-rose-600/30",
    },
    {
      id: "front",
      href: "/dining/front",
      nameZh: "前台",
      nameEn: "Front Office",
      roleZh: "外場服務員 / 領檯收銀",
      icon: Armchair,
      activeColor: "bg-blue-600 text-white shadow-md ring-2 ring-blue-600/30",
    },
    {
      id: "back",
      href: "/dining/back",
      nameZh: "後台",
      nameEn: "Back Office",
      roleZh: "廚房主廚 / 出餐結帳員",
      icon: ChefHat,
      activeColor: "bg-amber-600 text-white shadow-md ring-2 ring-amber-600/30",
    },
    {
      id: "admin",
      href: "/dining/admin",
      nameZh: "管理者",
      nameEn: "Manager",
      roleZh: "餐廳店經理 / 營運總監",
      icon: LayoutDashboard,
      activeColor: "bg-purple-600 text-white shadow-md ring-2 ring-purple-600/30",
    },
    {
      id: "franchise",
      href: "/dining/franchise",
      nameZh: "加盟主",
      nameEn: "Franchise",
      roleZh: "連鎖加盟門市投資主",
      icon: Building2,
      activeColor: "bg-emerald-600 text-white shadow-md ring-2 ring-emerald-600/30",
    },
  ];

  return (
    <nav aria-label="智慧餐飲五大專屬角色系統獨立分頁" className="mb-6 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-3 shadow-xs space-y-2">
      <div className="flex flex-wrap items-center justify-between px-2 pt-1 pb-2 border-b border-stone-100 dark:border-stone-800">
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-rose-500 animate-pulse" />
          <span className="text-xs font-black tracking-wide text-stone-900 dark:text-stone-100">
            {t("SMART DINING INDEPENDENT ROLE PAGES", "智慧餐飲五大專屬角色獨立分頁")}
          </span>
          <span className="rounded bg-rose-100 dark:bg-rose-950/60 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:text-rose-300">
            獨立路由 · 新分頁跳轉
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-stone-500 dark:text-stone-400 font-medium">
            點擊各角色皆以獨立新分頁（New Tab）開啟專屬工作台
          </span>
          <Link href="/#work" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition">
            <ArrowLeft size={13} />
            <span>返回作品集 ↗</span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {roles.map((r) => {
          const Icon = r.icon;
          const isActive = currentRole === r.id;
          return (
            <Link
              key={r.id}
              href={r.href}
              target={isActive ? undefined : "_blank"}
              rel={isActive ? undefined : "noopener noreferrer"}
              title={isActive ? "目前所在專屬頁面" : `以新分頁開啟 ${r.nameZh} (${r.href})`}
              className={`flex flex-col text-left p-3 rounded-xl border transition cursor-pointer no-underline ${
                isActive
                  ? r.activeColor
                  : "border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/50 hover:bg-stone-100 dark:hover:bg-stone-800/80 hover:border-stone-300 dark:hover:border-stone-700"
              }`}
            >
              <div className="flex items-center justify-between w-full mb-1">
                <div className="flex items-center gap-1.5">
                  <Icon size={16} />
                  <span className="font-black text-sm">{r.nameZh}</span>
                </div>
                <div className="flex items-center gap-1">
                  {!isActive && <span className="text-[11px] opacity-75 font-bold">↗</span>}
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    isActive ? "bg-white/20 text-white" : "bg-stone-200/80 dark:bg-stone-800 text-stone-700 dark:text-stone-300"
                  }`}>
                    {r.nameEn}
                  </span>
                </div>
              </div>
              <span className={`text-xs font-semibold line-clamp-1 ${isActive ? "text-white/95" : "text-stone-800 dark:text-stone-200"}`}>
                {r.roleZh}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
