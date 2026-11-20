# 系統邊界與工程 Harness

本文件是開發及交接用的邊界索引，不取代各 repo 的程式、migration、測試與部署紀錄。Portfolio、中央 Go 工作站、Vinext/Workers 網頁、六個獨立系統 repo、Linux 服務及 Windows 桌面端是不同交付面；共用產品名稱或網址不代表共用身分、資料庫、交易或部署。

## 證據層級與適用範圍

- **已存在的程式或路徑**：代表所引用 checkout 有相應程式／文件，仍須確認目標 repo、分支、commit 和測試。不能只由檔案存在推論它已部署。
- **已驗證的行為**：僅限引用文件明列的測試、CI、revision、主機或瀏覽器證據及其日期。API 測試不等於 UI 驗收；CI artifact 不等於安裝成功；image 發布不等於服務切換。
- **規畫／設計意圖**：`PLAN.md`、`HYBRID_SYNC_ARCHITECTURE.md` 等描述目標，除非對應程式、測試及運行證據都存在，不應表述成已交付功能。
- **使用者指示**：現行開發順序遵守架構文件 → 程式邊界 → 程式測試 → 程式碼。產品交付與目標架構若有不同，以本文件標明的實作現況為準，並將差異清楚列為遷移／待辦，不要自行假設資料已同步或服務已切換。

證據入口：[Construction map](CONSTRUCTION.md)、[Architecture handoff](ARCHITECTURE_HANDOFF.md)、[Development plan](PLAN.md)、[Active development](ACTIVE_DEVELOPMENT.md)、[Development status](DEVELOPMENT_STATUS.md)、[Acceptance matrix](ACCEPTANCE.md)、[engineering loop](engineering/LOOP.md)。這些狀態文件各有日期；請讀取日期與目標 repo 的遠端 `main`，再核對最近 CI、release、部署 revision、健康檢查及實際入口。Portfolio 的公開端點紀錄、各站部署和使用者 Windows 驗收可能是不同時間快照。

## 系統與程式邊界

| 專案／領域 | 現有邊界與參考路徑 | 變更責任及限制 |
|---|---|---|
| Portfolio (`profolio`) | 首頁、導覽及網站端位於 `app/`、`components/`、`lib/`；repo 對照在 `lib/project-repositories.ts`。 | 負責作品集與各系統入口；卡片或案例頁不擁有工作站交易。公開入口所指服務須由設定及運行證據確認。多語系（zh-TW/en）與深淺色主題切換（Dark/Light）屬於前端呈現與 Context 狀態管理，以 localStorage 持久化，不改變後端 API 與資料庫邊界。 |
| Workers/Vinext demo | `app/api/`、`lib/services/`、`db/`、`drizzle/`、`middleware.ts`、`worker/`。 | 自成一個 Web demo 與資料面。網站修正不會自動更新 Go 工作站或六個獨立 repo。 |
| 中央 Go/React station | `backend/main.go`、`backend/stations.go`、`backend/*` 領域模組、`backend/migrations/`、`web/src/`。 | 統一服務中的六套展示工作區。中央站有些流程可能先於獨立 repo；反向亦然。每個目標需分開實作、測試、遷移和部署。 |
| MES / ForgeFlow | 領域為 BOM、工單、領退料、報工、品檢、停機與成品；中央站對應 `backend/mes_*.go`，獨立系統為 `business-suite-mes`。成品/ERP 交界見 `engineering/MES_ERP_INTEGRATION.md`。 | MES 擁有製造執行與追溯資料。多工序報工完工量依最高工序累積、全單報廢守恆、後道良品受前道完工數約束、OEE 零分母防護。成品收貨事件不代表 ERP 已過帳；映射走明確 ERP 事件流程。 |
| ERP / LedgerWorks | 採購收貨、銷售出貨、庫存台帳、應收應付、傳票與盤點；中央程式在 `backend/erp_*.go`，獨立系統為 `business-suite-erp`。 | ERP 擁有其帳務與正式庫存交易。關帳期間嚴格禁止寫入傳票/發票/付款/盤點調整（409），底層觸發器保證庫存無負數（`balance_after >= 0`），調撥數量守恆（$\sum \Delta Q = 0$），成本依加權移動平均計算。不可與其他系統共寫庫存。 |
| POS / CounterPoint | 門市商品、購物車、班次、收銀、退貨、現金異動與日報；中央程式在 `backend/pos_*.go`，獨立系統為 `business-suite-pos`。 | POS 擁有收銀班次、交易與會員消費者配對（P07）。交易結帳綁定會員、發送 Outbox 事件；離線正式交易及跨系統即時庫存不能由現有展示推定已支援。 |
| CRM / RelationDesk | 潛客、客戶、商機、報價、活動、客服及同意；中央程式在 `backend/crm_*.go`，獨立系統為 `business-suite-crm`。 | CRM 擁有客戶商機與客服 SLA（R06 週末跳過計時）。潛客重複檢測（email/phone/taxId）與審批合併，已合併線索禁止重複轉換（409），GDPR 同意撤回即刻排除行銷名單。 |
| Dining / TableCraft | 訂位、桌次、點餐、KDS、拆帳、結帳及退款；中央程式在 `backend/dining_*.go`，獨立系統為 `business-suite-dining`。 | Dining 擁有桌次預約、KDS 出餐及帳務結算。桌位 90 分鐘重疊衝突拒絕（409），KDS 單向狀態機，D07 服務費拆單結算加總守恆，退款記錄原單反向連結。 |
| Shop / MarketLane | 商品、購物車、優惠、結帳、模擬付款、出貨及退款；中央程式在 `backend/shop_*.go`，獨立系統為 `business-suite-shop`；前台與 `/commerce` 管理面共用 Shop 邊界。 | Shop 擁有網路通路訂單。S04 優惠券折扣倒序分攤與配額原子遞減，結帳並發防超賣扣庫存（409），退款反向台帳，PostgreSQL 遷移相容。模擬 payment/webhook 不代表真實金流。 |
| Windows desktop | Rust/WebView2 supervisor 與本機 Go 服務，參考 `desktop/` 及各獨立 repo 的桌面程式。範圍以 MES、ERP、CRM 為主。 | 本機執行、登入、加密、資料移轉、復原與更新為另一驗收面。Windows CI 或打包不證明使用者電腦安全鎖定、資料可復原或跨 Windows 身分可移轉。 |

六個獨立系統 repo 各自擁有 `main`、程式、路由、migration、CI、release 和部署狀態；實際清單見 [`engineering/REPOSITORY_LINKS.md`](engineering/REPOSITORY_LINKS.md)。修改前明確選擇：Web demo、中央工作站、獨立站、桌面端，或其中多個。跨面功能必須列出要修改的每個 repo／服務及對應驗收，不能將一次程式改動說成所有產品面都完成。

## API、資料、租戶與身分

### API 與領域交易

- Web demo API 位於 `app/api/`，服務規則位於 `lib/services/`；API 形狀以 [`API.md`](API.md) 和相關程式為準。
- 中央與獨立 Go 工作站由 API 層做身分、租戶、角色及狀態檢查；中央路由入口參考 `backend/main.go`、`backend/stations.go`，分站工作階段、資料庫及執行隔離見 [`engineering/STATION_RUNTIMES.md`](engineering/STATION_RUNTIMES.md)。每個獨立 repo 的 API、schema 與授權都要在該 repo 獨立核對。
- 業務寫入需由服務端驗證狀態轉移、金額／數量界限、租戶、權限、冪等鍵及交易失敗回滾。前端隱藏按鈕不構成授權。實際規格與已覆蓋測試以 [`ACCEPTANCE.md`](ACCEPTANCE.md) 及該系統 tests 為準。
- 列印、標籤、手機／前台預覽應沿用所屬工作站身分和資料範圍；不要把預覽當獨立租戶或資料庫。

### 租戶與登入語意

- **Workers Web demo**：README 說明伺服器簽發 `demo_session_id` HttpOnly cookie 對應示範組織；`demo_user_role` 是訪客可切換的角色模擬。呼叫端自行提供的 organization/user/role header 不是可信身分來源。這不是正式員工登入、不可竄改角色或企業 RBAC。不得將真實客戶或財務資料放進 demo。
- **中央 Go station**：獨立工作站 session 在 API 驗證站台、帳號、租戶、角色與工作區；公開展示身分僅供 demo。私人 Portfolio owner、備份授權金鑰與 OAuth 是不同安全邊界，細節見 [`engineering/KEYED_WORKSPACE_ADMIN.md`](engineering/KEYED_WORKSPACE_ADMIN.md)、[`engineering/WORKSPACE_GOOGLE_OIDC.md`](engineering/WORKSPACE_GOOGLE_OIDC.md)；owner/OAuth 是否已初始化須依最新狀態核對。
- **獨立 Go stations**：各 repo 自有 session、租戶授權與帳號模型，不繼承 demo cookie 或中央 session。不能只靠 UI 登入成功、共用網域或相同 email 推論跨 repo 身分相同。
- **桌面本機身分**：桌面監督者與其 Go 服務使用本機 IPC／裝置認證；其 token、密鑰及資料不能複製到 Web 使用者 session。遵循桌面與系統 repo 的當前設計及復原政策。

安全變更若影響 session cookie、身份來源、租戶解析、角色授權、管理員初始化、公開代理或備份能力，須明列信任邊界、偽造／跨租戶／撤權測試與回滾方式。公開代理額外規則見 [`engineering/PUBLIC_DEMO_LOGIN_BOUNDARY.md`](engineering/PUBLIC_DEMO_LOGIN_BOUNDARY.md)。

### 資料儲存與來源權威

Portfolio 與獨立站有幾種不可混為一談的資料面：Workers 部署使用其 D1 binding（本機 Worker 預覽使用 local D1；測試另有 SQLite adapter）；Portfolio Linux Node Worker adapter 則由主站 gateway 及六個 `web-<site>` station processes 共用同一個持久 SQLite volume，這六個程序是路由／程序隔離，不是六個獨立資料庫；中央 Go station 使用另一份 SQLite；六個獨立 Go repo 各有自己的程式/schema/runtime data boundary；Windows 本機 Go 服務另有本機資料面。依據見 repo `README.md`、[`ARCHITECTURE_HANDOFF.md`](ARCHITECTURE_HANDOFF.md) 和 [`engineering/STATION_RUNTIMES.md`](engineering/STATION_RUNTIMES.md)。檔案／adapter 位置不代表資料已複製或已遷移；操作前要識別實際資料庫、volume、migration 與備份。

開發規劃 [`PLAN.md`](PLAN.md) 將 MES 製造、ERP 正式庫存與財務、POS 門市交易、CRM 商機、Dining 桌務與 Shop 網路通路各自劃分領域，並要求跨系統以版本化事件整合。這是責任邊界；任何特定部署的實際權威資料仍需讀該服務程式與遷移狀態。不得根據 `engineering/HYBRID_SYNC_ARCHITECTURE.md` 的目標權威表，推論所有雲地同步已完成。README 說明目前有 Shop 付款後履約任務 Outbox；完整 CRM→ERP→MES 或 POS／Shop 中央庫存同步尚未完成。MES 成品至 ERP 流程的具體邊界及其限制見 [`engineering/MES_ERP_INTEGRATION.md`](engineering/MES_ERP_INTEGRATION.md)。

新增／變更資料表需有 migration、租戶鍵與索引、唯一／外鍵／CHECK 條件、金額與時區語意、保留與刪除規則、冪等策略、備份與回復考量。不得覆寫不明來源資料庫，不得把 demo seed 當正式資料；升版前依各服務 runbook 備份並驗證遷移及 rollback。

## 部署、gateway 與桌面交付

- **Workers / Sites**：遵循 repo 的 Sites 發布文件和 `.openai/hosting.json` 綁定；`npm run build`、`npm start` 僅建置／本機預覽，不等同部署。部署後核對原生 deploy 終態、實際 URL、D1 migration、版本與 API 行為。
- **Linux / 中央 station**：依 [`infra/linux/README.md`](../infra/linux/README.md)、[`engineering/STATION-DELIVERY.md`](engineering/STATION-DELIVERY.md) 與 [`engineering/LINUX_DEPLOYMENT.md`](engineering/LINUX_DEPLOYMENT.md)。中央 gateway、主站、六個 station process 及共用 SQLite/服務有不同故障範圍；[`engineering/STATION_RUNTIMES.md`](engineering/STATION_RUNTIMES.md) 特別指出分程序並不代表獨立 DB 或 HA。
- **MES**：獨立發布、私有 OCI 與公開 Caddy 路由是分開關卡；資料/帳號移轉及 rollback 遵循 [`engineering/MES_PRODUCTION_MIGRATION.md`](engineering/MES_PRODUCTION_MIGRATION.md) 和 [`engineering/MES_PUBLIC_ROUTE_CUTOVER.md`](engineering/MES_PUBLIC_ROUTE_CUTOVER.md)。
- **ERP**：映像產出不表示私有服務或 public route 已啟用；依 [`engineering/ERP_PRIVATE_INGRESS.md`](engineering/ERP_PRIVATE_INGRESS.md) 與 [`engineering/ERP_PUBLIC_ROUTING.md`](engineering/ERP_PUBLIC_ROUTING.md) 驗收固定 upstream、health、資料持續性和外部入口。
- **CRM / POS / Dining / Shop**：各 repo 自己的 Actions、OCI 和路由文件為準；CI 發布映像只證明 artifact。確認實際 revision、容器健康、持久 volume、migration/資料連續性、DNS/TLS 及端到端流程。
- **Windows**：Rust supervisor、Go server、WebView2、SQLCipher、DPAPI、安裝包各自測試。CI build、啟動 smoke、已加密空白 DB 均不可代替既有資料 migration、錯誤密鑰拒絕、復原、休眠鎖定和使用者安裝驗收。依 [`engineering/GO_REACT_DESKTOP.md`](engineering/GO_REACT_DESKTOP.md) 及 [`engineering/WINDOWS_MIGRATION_SNAPSHOT.md`](engineering/WINDOWS_MIGRATION_SNAPSHOT.md) 查看目標與尚待驗證事項。

部署聲明要分別標註：程式合併、CI、映像／安裝包、主機部署 revision、health/API、公開路由和實際瀏覽器流程。DNS 文件 [`engineering/DOMAIN_STATUS.md`](engineering/DOMAIN_STATUS.md) 有歷史且相互矛盾的段落，不可單獨作為當前 HTTPS 證據。

## 測試與驗收邊界

先閱讀 [`ACCEPTANCE.md`](ACCEPTANCE.md) 及每個 repo 的測試索引。每個測試結論須說明其層級及範圍：單元／交易、租戶與 API、CI、build、artifact、OCI、公開 API、瀏覽器 UI、Windows 實機。API 200 不證明瀏覽器可操作；資料庫 write/read 不證明遷移正確；模擬付款不證明外部 webhook；固定工作量併發不證明生產容量。

涉及金額、庫存、工單、收銀、退款、退款／沖銷、結帳或跨系統整合時，測業務不變量、相同與不同冪等鍵、競爭、跨租戶、錯誤中斷和完整回滾。涉及 UI/列印/手機則以實際瀏覽器或裝置流程驗收；涉及部署則以 revision 與入口檢查。只執行使用者要求的驗證，不以未執行的預定測試填成 PASS。

### 本 Portfolio checkout 的命令與自動驗收入口

以下命令依本 checkout 的 `package.json`、`backend/go.mod`、`.github/workflows/engineering.yml`、README 和 [`engineering/LOOP.md`](engineering/LOOP.md) 整理。這是入口索引，不表示本次或其他執行者已執行，也不表示通過；執行前先確認依賴、環境、隔離資料與使用者要求。這些命令只適用 Portfolio repo，不能代替六個獨立系統 repo 的各自指令。

| 範圍 | 入口命令 | 證據與限制 |
|---|---|---|
| Portfolio Web 依賴／測試／型別／建置 | `npm run install:ci`；`npm test`；`npx tsc --noEmit`；`npm run build` | `package.json` scripts。Web demo 測試使用 repo 定義的 SQLite 測試 adapter；建置不是部署。全新 Workers local D1 migration 與預覽步驟見 repo `README.md`。 |
| Central Go station | `npm run go:test`（等價於 `go -C backend test ./...`）；CI race gate：`go -C backend test -race -timeout=25m ./...`；CI Linux build：`CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o ../release/station-server .`（在 `backend/` 執行） | scripts / workflow。只涵蓋這個 repo 的 `backend/`，不代表獨立 MES/ERP/POS/CRM/Dining/Shop Go repo 已測。 |
| React station web bundle | `npm run web:build` | `package.json`；建置輸出不是 host deploy 或 browser acceptance。 |
| Portfolio 與 station 瀏覽器 | `npx playwright test --config playwright.portfolio.config.ts`；`npx playwright test --config playwright.station.config.ts` | `.github/workflows/engineering.yml` 的 portfolio / station-delivery jobs；需要 Chromium，workflow 另啟動隔離服務與測試站。不要對正式站執行壓力或 fixture 流程。 |
| Linux service / infrastructure 整合 | `python infra/tests/smoke.py`；完整 Python infra tests：`npm run test:infra` | `infra/README.md` 與 `package.json`。`smoke.py` 需要可用的隔離 Compose 服務；先讀 `infra/README.md` 和 workflow 的 Compose 拓樸。 |
| 工程與站台隔離 gates | `npm run engineering:check`；workflow 還包含 `python3 scripts/verify-control-graph.py`、`node scripts/smoke-http.mjs http://127.0.0.1:8090`、`node scripts/smoke-station-isolation.mjs http://127.0.0.1:8090`、`python scripts/verify-station-outbox.py` | `package.json`、`.github/workflows/engineering.yml`。HTTP smoke 命令依賴 workflow 建立的隔離 Compose 測試服務；不要把 `127.0.0.1:8090` 指到不明／正式服務。 |
| Windows desktop package gate | `npm run desktop:prepare`；`npm run desktop:package` | `package.json` 與 workflow 的 `desktop-windows` job。需要 Windows 工具鏈；CI packaging/smoke 不代替使用者 Windows 安裝、既有資料遷移、復原與裝置驗收。 |
| 獨立系統 repo | 先讀該 repo 的 `README.md`、`package.json`/`go.mod`、`.github/workflows/`、測試與 release/runbook，再使用其定義的命令 | 不可從 Portfolio 的 `npm run go:test`、`engineering.yml` 或 artifact 推論另一 repo 的 Go tests、CI、OCI 部署或公開入口已成功。各 repo CI 狀態依指定 commit 查 GitHub Actions。 |

`infra:up`、`infra:preview`、Wrangler migration/deploy、SSH/OCI、DNS/route、`desktop:package` 等可能建立服務、寫入資料或輸出 artifact；這些不是只讀查詢。先按相應 runbook 和使用者授權確認目標環境、備份、隔離與 rollback，再執行。此索引不要求每次變更把所有命令跑一遍，只執行與目標及使用者要求相符的驗收。

## 每次變更的 Harness 順序

依使用者指定與 [`engineering/LOOP.md`](engineering/LOOP.md) 執行：

1. **架構**：在 `docs/DEVELOPMENT_STATUS.md` 或對應活動紀錄註明系統、功能、現狀、目標和依賴。寫資料流、交易邊界、來源權威、錯誤情境、版本相容及回滾；先確認服務／環境真的可用。
2. **程式邊界**：列出需要改動的 repo、API route、服務模組、DB/migration、前端、權限、background job、部署設定及任何不納入範圍。跨中央站／獨立站／Web demo／桌面端逐一拆開驗收，不能假設同步。
3. **測試**：先寫行為和安全測試，驗證預期失敗（Red）。包含正常路徑、拒絕路徑、租戶隔離、重送／並發、不變量、交易回滾與相容性；若只可在遠端測，記錄指定 PR head 的 Actions URL。
4. **程式碼**：完成最小修正後跑 Green，再重構並保留 Green。不要修改 expected value、降低安全強度或以 mock 偽裝真實整合來消除失敗。
5. **驗證／觀測**：依影響範圍執行型別、測試、建置、HTTP/API、瀏覽器、CI、部署或設備驗收。單獨記錄執行版本、環境、結果及限制；必要時檢查健康、資料持續性、冪等、死信、租戶隔離和資源使用。
6. **審查／交接**：讀精確 diff，更新狀態和證據，寫清已完成層級、未驗證項目、風險、rollback、下一步。PR 對應正確獨立 repo 的 `main`；合併、發布、部署和公開可用性分開記錄。

範例工程證據包含 [`engineering/MES_ERP_INTEGRATION.md`](engineering/MES_ERP_INTEGRATION.md)（事件、租戶、冪等、成本與測試邊界）、[`engineering/WORKSPACE_DATASET_PAGINATION.md`](engineering/WORKSPACE_DATASET_PAGINATION.md)、[`engineering/COMMERCE_CONCURRENCY.md`](engineering/COMMERCE_CONCURRENCY.md) 與 [`engineering/PORTFOLIO_RESOURCE_LIFECYCLE.md`](engineering/PORTFOLIO_RESOURCE_LIFECYCLE.md)。各文件的 Red/Green 或歷史驗證只適用文件指定功能及當時 revision，後續程式仍要重跑相應檢查。

## 使用者指示與規畫目標

`PLAN.md` 於 2026-10-30 撰寫時規畫單一 Vinext/Workers/D1 部署，再保留可拆站的領域模組；實際後續已形成中央 Go station、Workers Web demo 和六個獨立 Go repo 等並存面。`IMPLEMENTATION_HANDOFF.md` 和舊 `ORCHESTRATION.md` 是建立專案時的建構／交接指示，含當時尚未實作及 Sites 部署阻礙，不是現在的整體狀態。後續要求以 Go API + React 並為 MES/ERP/CRM 提供 Windows desktop 的遷移設計，參考 `engineering/GO_REACT_DESKTOP.md`；桌面技術後來又改為 Rust supervisor。進行工作時應遵循最新使用者明示指示，並按目標面的實際程式與驗收文件執行，不把任一歷史架構文件孤立當成今天所有服務的來源權威。
