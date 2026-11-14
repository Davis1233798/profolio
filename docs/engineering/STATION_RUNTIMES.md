# 分站獨立 Web 執行

`infra/linux/compose.web.yaml` 為 MES、ERP、POS、CRM、餐飲、電商各建立一個 `web-<site>` 容器。它們使用相同發布產物、各自執行 Node Worker adapter；主站 `web` 保留作品集、控制台、共用備份／重置 API 與唯一的 Outbox timer，並把分站頁面、領域 API、`/api/operations/<site>` 轉送到固定的站台 upstream。分站不對主機公開連接埠。

停止分站容器時，主站回傳 503，不會在主站程序繼續執行該分站。分站程序拒絕其他分站業務及主站控制路由；所有 upstream 名稱由固定 allowlist 產生，不能以 URL 指定任意主機。Session cookie、狀態碼及多筆 Set-Cookie 維持傳遞，回應標頭 `X-Suite-Station` 可驗證實際處理容器。

主站 IaC 控制台可選擇 `web-mes` 等站台服務，先規劃再啟停；計畫依服務圖計算影響範圍。`node scripts/infra.mjs stop mes --linux` 只停止 MES Web，不停止 MQTT／資料庫等共享依賴。重新啟動使用 `up mes --linux`，控制 API 則可針對 `web-mes` 建立 start 計畫。

## 資料與限制

業務仍使用同一個持久 SQLite volume，資料依組織隔離；這次分離的是執行程序與啟停生命週期。所有 schema 檢查與遷移在 `BEGIN IMMEDIATE` 中執行，避免同時初始啟動看見半套 schema；交易內 guards 不會在其他程序可寫入時暫時消失。六個真實子程序共用全新檔案的啟動測試通過。

共用主站入口、SQLite、gateway 與資料服務仍是共同依賴；停止主站入口會影響全部網站入口。這不是多節點 HA、獨立資料庫或單機吞吐量保證。只有主站執行派送 timer，分站啟動不會額外派送 Outbox。

## 驗證

- TDD Red：`station-routing.test.ts` 缺少路由模組而失敗；完成固定路由／邊界／編碼路徑與分站拒絕規則後 Green。
- Python 控制測試：MES Web 的 stop 計畫只影響 MES；ERP Web 及主站仍保持 running，跨站控制被拒絕。
- `sqlite-station-startup.test.ts`：六個獨立程序同時初始化同一個空白 SQLite 檔，檢查完整欄位及 guards。
- `smoke-station-isolation.mjs`：每個分站實際 stop → 其頁面／API 回 503 → 主站與其他五站 API 仍回 200 且由各自容器處理 → finally start → 原有資料 ID 保留。
- `smoke-http.mjs`：跨六個程序完成原有交易／權限／租戶隔離流程。
- Compose 圖驗證、35 項應用、15 項 Python、型別、正式建置及導航 ABI gate 通過。

CI 定義已加入逐站啟停測試；遠端 CI 執行狀態須另行驗證，不能以本機／Linux 收據推論 GitHub Actions 已執行。

2026-10-30 release `20261030-16`：修正電商後台 `/commerce` 路由歸屬為 shop；新增 alias 路由 Red/Green。Linux 六站停啟再次通過，shop 停止時 `/shop`、領域 API 與 `/commerce` 皆 503，重啟後後台回應包含 `X-Suite-Station: shop`。收據 `/srv/business-suite/shared/station-isolation-16.log`。

## Dining standalone OCI acceptance

The ARM64 Dining candidate at revision 5894f22 was exercised privately on
OCI. The container runs as UID 10001 and GID 999. Mount its writable state
volume at /srv/station/data, where SUITE_DB points to stations.sqlite.

Acceptance covered front-office login, menu reads, order creation, container
recreation against the persistent volume, and verification of new order
writes in that volume. The preceding tested image c042424 started against
the same volume and retained the existing orders. The candidate was then
restarted on 5894f22.

Public ingress still serves the shared Portfolio backend. The legacy
SQLite source contained 1,647 dining orders across 1,639 workspaces at the
time of inspection, including eight non-fixture orders. Verify ownership
and preservation of those records before routing visitors to separate
state. Keep identifiers and private data in the deployment environment.
