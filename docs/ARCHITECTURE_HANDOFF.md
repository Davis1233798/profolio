# Business Suite 程式架構與推版

版本基準：2026-11-08（台北時間）。下列「獨立版」指各系統 GitHub
repo 的 `main`。「中央站」指作品集 repo 裡共用一套 Go 服務的六套
展示工作區。中央站已有的功能可能還沒移到獨立版。

## 程式怎麼分

```mermaid
flowchart LR
  V[訪客] --> P[作品集首頁]
  P --> S[中央站 React 前台與後台]
  S --> G[中央 Go API]
  G --> D[(中央站 SQLite)]
  V --> L[各系統公開子網域]
  L --> W[共用 Vinext Web]
  W --> WDB[(Web SQLite)]
  M[獨立 MES Go 服務] --> MDB[(MES 專用 SQLite)]
  R[Windows Rust 桌面應用 (WebView2 / Process Supervisor)] --> B[本站 Go 程序]
  B --> EDB[(Windows 本機 SQLite)]
```

- **作品集與既有 Web**：`app/` 放首頁、系統 Web 路由及 `app/api/`。
  `components/` 放 UI 與互動特效；`lib/` 放既有服務、身分及資料邏輯；
  `drizzle/` 管 Web schema。公開首頁連到中央站的
  `/{system}/login?view=front|back`。
- **Go 工作站**：`web/src/` 放 React 頁面與交易表單；`backend/main.go`
  接登入與 HTTP，`backend/stations.go` 分派到
  `/api/stations/{system}/{action}`，交易寫入在對應的 Go 業務模組。
  `backend/migrations/` 放 schema 與示範資料。前後台參數決定入口，
  實際權限由 API 驗證帳號、租戶、角色與工作區。行動、列印與標籤預覽
  沿用同一身分與資料；預覽不另外建立工作區。
- **系統 repo**：MES、ERP、CRM、電商、POS、餐飲各有自己的 `main`、
  CI、Go 路由與 schema 標記。修改中央站不會同步改到獨立 repo，反之亦然。
  修改一項功能前先確認交付目標是中央展示、獨立 Web 或 Windows。
- **Windows**：產品範圍是 MES、ERP、CRM（及作品集桌面示範）。桌面端全面採用 **Rust** 完成原生 Windows 桌面應用程式（基於 WebView2 與進程監督者架構），取代笨重的 Electron 執行階段。Rust 桌面端具備三大職責：(1) Windows 原生 DPAPI (`CryptProtectData` / `CryptUnprotectData`) 加密保護本機 SQLCipher 金鑰 (`database-key.dat`) 與離線裝置身分驗證資料 (`device-auth.dat`)；(2) 本機 Go 背景進程生命週期監督 (透過 stdin pipe 傳送 256-bit SQLCipher 金鑰、動態解析本機 port、注入隨機密鑰 header `X-Suite-Desktop-Secret`、監聽進程健康)；(3) 離線安全鎖定與單一實例 (以 Named Mutex 確保單一實例運行、5 分鐘閒置或系統休眠自動鎖定並終止本機 Go 服務)。CI 套件驗證和使用者電腦上的安裝、資料移轉與復原分別驗收。
- **公開與私人功能**：訪客使用各自的示範資料。公開示範身分只適用工作站。
  作品集私人備份、匯出、還原與金鑰由另一組受保護的 Web API 管理。

## 各專案做到哪裡

### 作品集（profolio）

- **已完成**：英文預設與繁中切換、點擊及語系動效、六套系統各自的前台／後台入口、
  示範角色選擇。中央工作站提供行動、工作區、列印與標籤預覽。MES 與電商
  有受限併發展示。私人備份與金鑰工具有受保護路由。
  瀏覽器長時間資源生命週期與記憶體回歸測試（[#29](https://github.com/Davis1233798/profolio/pull/29) 已合併）。
  Windows 原生 Rust 桌面端進程監督者整合與 Electron 拆除（[#34](https://github.com/Davis1233798/profolio/pull/34) 已合併，commit `0cf0fc2d`）。
- **功能邊界**：首頁負責展示及導航。交易由工作站處理。中央 Go 服務與
  既有 Web 各自使用資料庫；同一公開網域下的不同入口也可能走不同服務。
  併發展示驗證的是固定工作量下的交易結果。
- **未完成**：私人擁有者與 Google OAuth 設定依使用者指示延後。
- **推版**：合併 `main` 觸發 `engineering.yml`；Web、基礎設施、
  Go 工作站、k6、Windows 原生桌面和部署檢查通過後自動更新 OCI。建置使用
  `NEXT_PUBLIC_STATION_URL` 指向中央站。驗收首頁與中央站
  `/api/health` 的 revision。[最新部署 42431174319 通過](https://github.com/Davis1233798/profolio/actions/runs/42431174319)，線上端點健康狀況與版本 SHA 一致。

### MES（ForgeFlow）

- **已完成**：獨立 Go 版含工單開工與報工、批號、用退料、品檢、
  停機與結案。成品模組有批次、品質判定、隔離處置與入庫。
  舊資料帳號對應、報工重試轉換（[#17](https://github.com/Davis1233798/business-suite-mes/pull/17) 已合併）。
  Windows 原生 Rust 桌面端進程監督者整合（[#18](https://github.com/Davis1233798/business-suite-mes/pull/18) 已合併，commit `a9808210`），完全取代 Electron，CI 驗證通過。
  有受限業務併發測試、列印、分頁及 Windows 打包。獨立 OCI 私有端點
  `127.0.0.1:18095` 已驗證。
- **功能邊界**：`mes_business.go` 管工單狀態、報工數量與重試；
  `mes_operations.go` 管生產現場紀錄；`mes_finished_goods.go`
  管成品放行與入庫。獨立 MES 管自己的製造資料，中央站的跨系統
  MES／ERP 整合另有 API。公開 MES 子網域目前仍走共用 Web。
- **未完成**：獨立 Go 版的工單建立、BOM 編修與中央站功能需逐項對照；
  公開切換尚待驗證。離線匯入測試目前使用合成資料。
- **推版**：`mes.yml` 驗證 Go、Windows 原生 Rust 桌面、rootless 主機與回滾；
  `main` 發布 SHA 標籤映像與部署套件。啟用 `MES_DEPLOY_ENABLED` 後，
  `mes-production` 透過固定 SSH 指令更新獨立服務。
  公開路由切換由作品集的 Caddy 設定另外管理。[部署紀錄](https://github.com/Davis1233798/business-suite-mes/actions/runs/42390060039)

### ERP（LedgerWorks）

- **已完成**：獨立 Go 版含採購建立、核准、拒絕及分批收貨；
  銷售單建立、確認及出貨；跨倉庫庫存調撥（[#10](https://github.com/Davis1233798/business-suite-erp/pull/10) 已合併）；
  採購退貨（[#14](https://github.com/Davis1233798/business-suite-erp/pull/14) 已合併）；
  應收應付、付款、傳票過帳及實體盤點。
  獨立 OCI 映像候選與私有候選演練、ARM64 容器更換持續性驗證、rootless 主機帳號與 gateway 隔離驗證（[#12](https://github.com/Davis1233798/business-suite-erp/pull/12) 已合併）。
  Windows 原生 Rust 桌面端進程監督者整合（[#15](https://github.com/Davis1233798/business-suite-erp/pull/15) 已合併，commit `ed150fbf`），完全取代 Electron，CI 驗證通過。
  交易按租戶驗證角色，庫存與成本更新、稽核和重試紀錄一起提交。
- **功能邊界**：`purchases.go` 管收貨及入庫，`sales.go` 管出貨與出庫成本，
  `stock_transfer.go` 管倉庫間調撥與成本保留，
  `purchase_return.go` 管收貨單退貨出庫、台帳扣抵、移動平均成本扣除與審計紀錄，
  `billing.go` 管單據與付款，`journal.go` 管平衡傳票，
  `stock_count.go` 依台帳版本核准盤差。中央站另外有主檔與 MES 收貨整合；需以獨立 repo 的 `main` 確認是否已移植。
- **未完成**：獨立版仍缺完整關帳流程；公開子網域切換待驗收。
- **推版**：`erp.yml` 在 `main` 驗證並發布
  `business-suite-erp-station:<SHA>`（AMD64）與
  `business-suite-erp-station:<SHA>-arm64`。目前主分支發布映像，
  私有 OCI 啟用與公開路由另行驗收。[最新發布紀錄](https://github.com/Davis1233798/business-suite-erp/actions/runs/42393249264)

### CRM（RelationDesk）

- **已完成**：獨立 Go 版含線索建立、資格判定、原子轉換成客戶／聯絡人／商機，
  以及商機階段推進、結案與重開。支援角色、擁有者、稽核與安全重試。
  Windows 已有打包、SQLCipher 驅動驗證，以及已提交 WAL 的 SQLCipher 唯讀加密匯出驗證（[#8](https://github.com/Davis1233798/business-suite-crm/pull/8) 已合併）。
  Windows 原生 Rust 桌面端進程監督者整合（[#9](https://github.com/Davis1233798/business-suite-crm/pull/9) 已合併），具備 Win32 DPAPI 金鑰解密、Loopback IPC 隨機密鑰驗證、單一實例 Named Mutex，完成 Linux + Windows 雙平台驗證與映像發布。
- **功能邊界**：`stations.go` 管線索與租戶可見範圍，
  `opportunity_stage.go` 管商機狀態、機率與加權金額。
  中央站的聯絡人與同意、活動、報價版本及客服操作有另外的 API。
- **未完成**：上述中央 CRM 寫入流程尚未完整移到獨立版。
  正式遷移流程、DPAPI 金鑰包裝、跨 Windows 使用者復原及
  獨立 OCI 仍待交付。
- **推版**：`crm.yml` 驗證 Go、瀏覽器、Windows 原生 Rust 桌面和映像；`main`
  發布 `business-suite-crm:<SHA>`。獨立 OCI 尚未啟用。
  [主分支發布紀錄 42435679241 通過](https://github.com/Davis1233798/business-suite-crm/actions/runs/42435679241)

### 電商（MarketLane／Shop）

- **已完成**：獨立 Go 版有商品瀏覽、結帳與優惠券、付款回呼、
  出貨、退款 API，以及隔離的結帳併發測試。
  購物車結帳、售後退款、評價、營運快照與業務併發處理寫入流程及測試套件全數移植完成（[#11](https://github.com/Davis1233798/business-suite-shop/pull/11) 已合併，commit `3b3d16b`）。
  後台資料、列印預覽與分頁有遠端檢查。
- **功能邊界**：結帳處理金額與庫存保留；付款回呼確認交易；
  出貨與退款各自依訂單狀態處理。支付驗證使用示範環境，
  公開服務健康端點目前標示 `payment: mock`。購物車、售後與評價已對照中央站完整移植。
- **未完成**：真實金流結算、以及獨立 OCI、資料移轉和公開路由驗收。
- **推版**：`shop.yml` 在 `main` 驗證並發布
  `business-suite-shop-station:<SHA>`（[主分支發布紀錄 42434516847 通過](https://github.com/Davis1233798/business-suite-shop/actions/runs/42434516847)）。發布映像後仍需完成 OCI 部署。

### POS（CounterPoint）

- **已完成**：獨立 Go 版含站台登入、角色、資料查詢、分頁與收據／標籤預覽。
  條碼查詢、購物車、掛單取單、班別開關班、收銀結帳、退貨與日報等中央寫入流程及測試套件全數移植完成（[#5](https://github.com/Davis1233798/business-suite-pos/pull/5) 已合併，commit `940c6bb`）。
  支援收銀員身分租戶自動對應與收據預覽權限。
- **功能邊界**：獨立版的 `stations.go` 完整提供資料、帳號、條碼、購物車、班別與日報路由；
  資料模型與租戶隔離已全數在獨立版 Go 服務實現。
- **未完成**：獨立 OCI 和公開切換也未驗收。
- **推版**：`pos.yml` 驗證並在 `main` 發布
  `business-suite-pos-station:<SHA>`（[主分支發布紀錄 42433088816 通過](https://github.com/Davis1233798/business-suite-pos/actions/runs/42433088816)）。

### 餐飲（TableCraft／Dining）

- **已完成**：獨立 Go 版含站台登入、角色、資料查詢、分頁與列印預覽。
  訂位管理、桌次開桌、出餐流程、拆帳結算、外帶退款與營運快照寫入流程及測試套件全數移植完成（[#5](https://github.com/Davis1233798/business-suite-dining/pull/5) 已合併，commit `d93425f`）。
  支援 authoritative bill summaries 與資料集查詢分頁。
- **功能邊界**：獨立版的 `stations.go` 完整提供資料、帳號、列印、訂位、桌次、點餐與退款路由；
  管理實際桌次及訂單狀態。
- **未完成**：獨立 OCI 和公開切換也未驗收。
- **推版**：`dining.yml` 驗證並在 `main` 發布
  `business-suite-dining-station:<SHA>`（[主分支發布紀錄 42433633664 通過](https://github.com/Davis1233798/business-suite-dining/actions/runs/42433633664)）。

## 通用推版步驟

1. 在要交付的 repo 確認 `origin/main`，從它建立 `codex/<feature>` 分支。
2. 先寫架構與功能邊界，再補能驗證行為的測試與程式。若中央站與獨立
   版都需要同一功能，兩邊分別修改及驗收。
3. 提交並推分支，用 PR 對 `main`，由 GitHub Actions 執行測試。
   檢查 PR 最新提交的結果、審查差異及合併狀態。
4. 通過後合併到 `main`。查主分支 Actions 的同一個 commit，
   確認套件或映像發布。作品集與獨立 MES 有自動 OCI 部署；
   ERP、CRM、電商、POS、餐飲的現行 `main` 以發布映像為交付點。
5. 有部署的專案查執行中的 revision 與實際入口。獨立服務健康檢查、
   公開子網域切換、資料移轉是各自的驗收項目。

最常用的 GitHub CLI 指令：

```text
git fetch origin main
git switch -c codex/<feature> origin/main
git push -u origin codex/<feature>
gh pr create --base main
gh pr checks <PR>
gh run list --branch main --limit 5
```
