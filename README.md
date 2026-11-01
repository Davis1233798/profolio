# Business Suite Portfolio

目前開發系統、功能、階段與遠端驗證狀態請見 [開發狀態](docs/DEVELOPMENT_STATUS.md)；每次變更遵循 [開發順序](docs/engineering/LOOP.md)。

新增主站 `/platform` 基礎設施中心與 `/mes/industrial` 設備量測頁；開發前端依 [站台模板](docs/design/README.md) 的區域樣式。
集中式 Docker Compose、Redis、RabbitMQ、MQTT、TimescaleDB 及 PostgreSQL 分片見 [IaC 操作](infra/README.md)，[Linux 部署](infra/linux/README.md)；[TDD 開發循環](docs/engineering/LOOP.md)。這些服務與現有 D1 並存，正式環境需另設定 HTTPS gateway 與 Outbox cron。

主站服務管理使用獨立操作憑證，可查詢即時狀態並建立／執行啟停與重啟計畫。MES 工單摘要透過交易內 Outbox 持續同步至 PostgreSQL 分片查詢模型；既有 D1 請追加套用 `drizzle/0003_mes_projection.sql`，Linux Node 適配器會於啟動時套用。交易主庫與原有業務不變量仍保留。

繁體中文個人作品首頁與六套具持久化後端的商業系統展示版。使用 React 19、TypeScript、Vinext、Cloudflare Workers / D1、Drizzle 與 Tailwind。金額以整數 TWD 計算，時間儲存 UTC、操作時間以 Asia/Taipei 呈現。

本版本可操作核心流程，並非 `docs/PLAN.md` 全部規格的正式商用交付。功能及驗證邊界見 [驗收對照](docs/ACCEPTANCE.md)，請勿用舊進度文件中的階段名稱推論全部功能已驗收。

## 本地啟動

需要 Node.js 22.13 以上（建議使用專案驗證時的 Node 24）、npm 與 Git。測試會使用 Node 內建 SQLite；第一次執行可能顯示 experimental 提示。

```powershell
npm run install:ci
npm run build
```

Workers 本地預覽使用真正的本地 D1，而不是測試用的 `.data/portfolio.sqlite`。全新本地 D1 先依序套用兩個 SQL 檔；已有資料庫不要重播 `0000`。

```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_spicy_bromley.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_transaction_guards.sql
npm run dev
```

開啟終端機實際印出的 loopback URL；portable 開發預設從 `http://localhost:5173` 起。首個 API 請求會依展示 cookie 建立該訪客的組織與固定種子資料。重新啟動保留同一 cookie 與 D1 state 時，資料仍存在。

```powershell
npx tsc --noEmit
npm test
npm run build
npm start
```

`npm start` 以 Wrangler 在 loopback 預覽建置產物，使用同一 `.wrangler/state`。`npm test` 在獨立測試組織及 Node SQLite shim 執行；通過不等於已驗證雲端 D1 的所有競爭情境。`.data/`、`.wrangler/`、`dist/` 與 `.sites-runtime/` 為本地／產生資料，不應提交。

不需要真實金流或郵件 API key；`.env.example` 僅記錄可選的預覽設定。缺少 `DB` binding 時應修復綁定與 migration，不要把 Workers 改成讀寫主機檔案。

## 畫面與操作

| 路徑 | 系統 | 可操作流程 |
|---|---|---|
| `/` | Portfolio | 六套作品介紹、案例說明與實際入口；未提供姓名與經歷，因此不虛構個人資歷 |
| `/mes` | ForgeFlow | BOM 版本、建立工單、下達、領退料、開工、良品／報廢報工、品檢、停機及 OEE |
| `/erp` | LedgerWorks | 商品主檔、採購／審核／收貨、銷售／出貨、庫存調撥、收付款及試算表 |
| `/pos` | CounterPoint | 商品收銀、收款找零、掛單取單、開班交班、原單退貨、重印小票及日報 |
| `/crm` | RelationDesk | 潛客轉換、階段看板、聯絡人查重、活動、報價版本核准、客服 SLA 及撤回行銷同意 |
| `/dining` | TableCraft | 桌位預約／開桌、菜單規格加點、KDS 出餐、退菜、含服務費分單結帳 |
| `/shop` | MarketLane | 搜尋與分類、選規格、改購物車數量、優惠碼、地址快照、結帳、模擬付款、購後評價 |
| `/commerce` | MarketLane 營運 | 訂單／淨營收、付款狀態、整單模擬出貨、原單商品退款與物流單號 |

建議由導覽列選「管理員」走完整示範流程，再切換「作業員」與「唯讀」觀察拒絕操作。重置按鈕只清理自己的展示組織，重新建立種子；會清除該展示空間的新增單據。測試資料及畫面上的公司、商品與人物均為示範。

電商測試例：價格 100 的 M 號商品數量 2、優惠碼 `SAVE10`，商品小計 200，折扣 20，加固定運費 60，應付 240。建立訂單後在訂單紀錄模擬付款，再到營運頁出貨。未付款庫存保留 15 分鐘，後續商品查詢、結帳或付款請求會觸發過期釋放。

## 展示空間與權限

`demo_session_id` 是伺服器建立的 HttpOnly UUID cookie，有效期七日；每個 cookie 對應自己的組織。請求指定的 `x-organization-id`、`x-user-id`、`x-user-role` 不作為身分來源。`demo_user_role` 可由畫面切換，用來在同一訪客的展示空間模擬角色；這是可自行切換的 sandbox，並非正式登入、員工身分證明或生產 RBAC。

管理員可操作示範審核、退款與重置；作業員執行一般流程；唯讀角色的寫入由 API／服務層拒絕。CRM 漏斗依角色篩選，但現有業務操作仍採團隊寫入語意，不能視為完整業務員個別資料授權。請勿將真實客戶、財務或個資放入此展示系統。

## 原始碼與部署

- `db/schema.ts`：資料模型；`drizzle/`：初始表與交易保護 migration。
- `lib/services/`：六個領域服務；`app/api/`：HTTP 邊界；[API 契約](docs/API.md)。
- `middleware.ts`：訪客空間及首次 seed；`worker/index.ts`：request-scoped D1 綁定。
- `.openai/hosting.json`：既有 Sites project identity 與 `DB` 綁定，更新時保留。
- `tests/`：金額、不變量、隔離、重送及部分併發情境；[驗收對照](docs/ACCEPTANCE.md)。

使用 Sites 發布時須依 Sites 技能建置、同步來源、套用 migration 並由原生工具部署，保留既有 audience 與 project ID。本 README 不代表網站已部署成功；發布結果與真實 URL 由該次部署回傳確認。一般 `npm run build` 或 `npm start` 不會發布。

## 已知限制

- 金流、物流、發票及任何寄送均為模擬；不會收取真實款項。付款模擬器不是已驗簽的外部 webhook。
- 六個領域使用各自庫存／種子資料；Outbox 已接電商付款後的履約任務隊列，尚未完成 CRM→ERP→MES 或 POS／電商中央庫存同步。
- MES 尚無完整產能排程、重工放行與成品庫整合；ERP 為簡化會計，盤點核准、完整沖銷與正式稅務不齊全。
- POS 需要連線才能收款，未實作離線正式交易。CRM 尚無公司／聯絡人合併，SLA 排除週末但不含國定假日。
- 餐飲提供預付外帶、催單、90 分鐘訂位與管理員整單退款；實體 QR 圖碼派送仍待整合。電商以整單出貨、管理員直接商品退款，未含部分履約與分階段退貨審核。
- 首頁提供完整業務資料 JSON 備份、同一展示空間原子還原及 CSV 匯出。身分、稽核與重送快取不還原；上限 5 MB / 10,000 筆，不取代正式災難復原。
- 訪客角色可自行切換；沒有正式帳密、組織邀請、不可竄改的企業稽核、資料保留政策或完整防濫用機制。
- 自動化測試不包含全套瀏覽器無障礙／行動版矩陣、雲端壓測與所有錯誤恢復情境。尚未驗證的項目不得宣稱通過。

餐飲外帶遷移（前兩個遷移之後只執行一次）：
```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_dining_takeout.sql
```

# Go / React / Electron 遷移工作區（2026-10-31）

使用者最新架構指定：Go API + React、多裝置 Web、Electron 桌面版。新程式位於 `backend/`、`web/`、`desktop/`；執行與已驗證／尚未移植的範圍見 [遷移紀錄](docs/engineering/GO_REACT_DESKTOP.md)。目前公開站台仍是原版本，不能把新架構預覽當成全部交易功能已完成遷移。

## 分站登入與持續交付

首頁每個案例的「登入獨立工作站」會另開對應的分站路徑。開發環境預設使用 `http://127.0.0.1:8095`；部署時必須在建置前設定 `NEXT_PUBLIC_STATION_URL` 指向實際分站服務。未配置的非本機環境不顯示該入口。

```powershell
npm run web:build
$env:SUITE_WEB = (Resolve-Path web-dist).Path
go -C backend run .
```

Go 分站各自使用獨立登入工作階段，可同時以不同身分登入不同站台；登出只影響目前站台。Go 分站的 `/mes/front`、`/erp/front`、`/pos/front`、`/crm/front`、`/dining/front` 與 `/shop/front` 有各自的網址和站台授權。登入後可在同一頁開啟前台／後台預覽與手機尺寸預覽；具後台授權的身分可展開列印與標籤預覽。這是可互動的展示空間：同一身分操作使用同一組資料，預覽會話不是獨立資料庫。Go 原型的業務交易寫入仍在移植；原有互動展示入口保留現有功能，兩者的登入與資料庫不共用。

GitHub Actions `TDD and engineering loop` 在 push／PR 執行原有網頁和基礎設施驗證，另驗證 Go 測試與分站前端建置。推送 `master` 成功後上傳含 Linux server 與前端靜態檔的版本化 artifact，供下載、驗收及部署。此為持續交付產物；沒有設定正式部署主機、遷移與憑證，工作流程不會自動更新線上網站。
