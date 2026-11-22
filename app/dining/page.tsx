"use client";

import { useEffect } from "react";

export default function DiningPage() {
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const v = params.get("view") || params.get("role") || params.get("interface") || params.get("tab");
      if (v === "customer" || v === "guest") {
        window.location.replace("/dining/customer");
      } else if (v === "back" || v === "kitchen" || v === "billing") {
        window.location.replace("/dining/back");
      } else if (v === "admin" || v === "manager") {
        window.location.replace("/dining/admin");
      } else if (v === "franchise" || v === "owner") {
        window.location.replace("/dining/franchise");
      } else {
        window.location.replace("/dining/front");
      }
    }
  }, []);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-8 text-center text-stone-600 dark:text-stone-300">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent mb-4" />
      <h2 className="text-lg font-bold">正在自動跳轉至獨立角色專屬頁面...</h2>
      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
        智慧餐飲現已完全拆分為五大獨立路由頁面，系統正在將您導向專屬頁面中。
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <a href="/dining/customer" className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition shadow-xs">📱 用戶端點餐</a>
        <a href="/dining/front" className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs">🍽️ 前台現場</a>
        <a href="/dining/back" className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition shadow-xs">🍳 後台廚房</a>
        <a href="/dining/admin" className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition shadow-xs">📊 管理者店長</a>
        <a href="/dining/franchise" className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-xs">🏢 加盟主門市</a>
      </div>
    </div>
  );
}
