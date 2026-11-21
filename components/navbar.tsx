"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import platformStyles from "./platform-dashboard.module.css";
import mesStyles from "@/app/mes/mes-workbench.module.css";
import { usePortfolioLocale } from "./portfolio-experience";
import {
  Layers,
  Factory,
  Database,
  Calculator,
  Users,
  UtensilsCrossed,
  ShoppingBag,
  SlidersHorizontal,
  Home,
  Menu,
  X,
  Sun,
  Moon,
} from "lucide-react";

export function Navbar() {
  const pathname = usePathname();
  const isPlatform = pathname === "/platform";
  const isMes = pathname === "/mes" || pathname.startsWith("/mes/");
  const [menuOpen, setMenuOpen] = useState(false);
  const { t, theme, toggleTheme, locale, setLocale } = usePortfolioLocale();

  const navItems = [
    { label: "Portfolio", labelZh: "作品集首頁", href: "/", icon: Home },
    { label: "Infrastructure", labelZh: "平台基礎設施", href: "/platform", icon: Layers },
    { label: "MES Manufacturing", labelZh: "智慧製造 ForgeFlow", href: "/mes", icon: Factory },
    { label: "ERP Operations", labelZh: "企業營運 LedgerWorks", href: "/erp", icon: Database },
    { label: "POS Retail", labelZh: "門市零售 CounterPoint", href: "/pos", icon: Calculator },
    { label: "CRM Customers", labelZh: "客戶關係 RelationDesk", href: "/crm", icon: Users },
    { label: "Dining", labelZh: "智慧餐飲 TableCraft", href: "/dining", icon: UtensilsCrossed },
    { label: "E-commerce", labelZh: "品牌電商 MarketLane", href: "/shop", icon: ShoppingBag },
    { label: "Commerce Admin", labelZh: "Commerce 電商管理", href: "/commerce", icon: SlidersHorizontal },
  ];

  return (
    <header
      data-suite-navigation
      data-no-particles
      className={`suite-navigation sticky top-0 z-50 w-full border-b border-stone-200 bg-white/95 backdrop-blur-md ${
        isPlatform ? platformStyles.navigation : ""
      } ${isMes ? mesStyles.navigation : ""}`}
    >
      {/* Main Navigation */}
      <div className="suite-nav-main">
        <Link href="/" className="suite-brand">
          <div
            data-suite-brand
            className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center font-black text-sm"
          >
            BS
          </div>
          <div className="flex flex-col leading-tight">
            <span>{t("Business Suite", "Business Suite 商業套件")}</span>
            <span className="text-[10px] font-normal text-stone-500 tracking-normal">
              {t("Business systems portfolio", "商業系統作品集")}
            </span>
          </div>
        </Link>

        <nav aria-label={t("System navigation", "系統導覽")} className="suite-desktop-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"));
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium transition ${
                  isActive
                    ? "bg-blue-50 dark:bg-blue-950/40 text-primary font-semibold"
                    : "text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white hover:bg-stone-50 dark:hover:bg-stone-800"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? "text-primary" : "text-stone-500 dark:text-stone-400"}`} />
                <span>{locale === "zh-TW" ? item.labelZh : t(item.label)}</span>
              </Link>
            );
          })}
        </nav>

        {/* Quick controls in navbar */}
        <div className="hidden lg:flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="p-1.5 rounded-md text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-stone-800 transition"
            aria-label={t("Toggle color theme", "切換深淺色系")}
            title={theme === "dark" ? t("Theme: Dark", "目前色系：深色模式") : t("Theme: Light", "目前色系：淺色模式")}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            type="button"
            onClick={() => setLocale(locale === "en" ? "zh-TW" : "en")}
            className="px-2 py-1 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-stone-800 transition"
            aria-label={locale === "zh-TW" ? "Switch language to English" : "切換語言至繁體中文"}
          >
            {locale === "zh-TW" ? "EN" : "繁中"}
          </button>
        </div>

        {/* Mobile Nav Button */}
        <div className="suite-menu-toggle">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            aria-controls="suite-mobile-menu"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? t("Close navigation", "關閉選單") : t("Open navigation", "開啟選單")}
            className="p-2 rounded-lg border border-stone-200 dark:border-stone-700"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav id="suite-mobile-menu" aria-label={t("Mobile system navigation", "行動端系統導覽")} className="suite-mobile-nav">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              aria-current={pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/")) ? "page" : undefined}
              className={`flex items-center gap-2 p-3 rounded-lg text-xs ${
                pathname === item.href
                  ? "bg-primary text-white"
                  : "bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-200"
              }`}
            >
              <item.icon size={16} />
              <span>{locale === "zh-TW" ? item.labelZh : t(item.label)}</span>
            </Link>
          ))}
          <div className="flex items-center justify-between p-3 border-t border-stone-200 dark:border-stone-700 mt-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex items-center gap-2 text-xs text-stone-700 dark:text-stone-300"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              {theme === "dark" ? t("Theme: Dark", "深色模式") : t("Theme: Light", "淺色模式")}
            </button>
            <button
              type="button"
              onClick={() => setLocale(locale === "en" ? "zh-TW" : "en")}
              className="text-xs font-semibold px-3 py-1 bg-stone-200 dark:bg-stone-700 dark:text-stone-200 rounded-md"
              aria-label={locale === "zh-TW" ? "Switch language to English" : "切換語言至繁體中文"}
            >
              {locale === "zh-TW" ? "English" : "繁體中文"}
            </button>
          </div>
        </nav>
      )}
    </header>
  );
}
