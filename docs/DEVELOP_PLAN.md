# 全作品集開發與交付計畫

**基準日：2026-11-18（Asia/Taipei）。** 此計畫以 freshly fetched portfolio `origin/main`（`db09380`）為文件基線，狀態快照依 [Active development](ACTIVE_DEVELOPMENT.md)、[Development status](DEVELOPMENT_STATUS.md)、[Acceptance](ACCEPTANCE.md)、[Architecture handoff](ARCHITECTURE_HANDOFF.md)、本次更新的 [Handoff](HANDOFF.md) 與原始 [PLAN](PLAN.md)。handoff 對各系統 main SHA/CI 的查詢日為 2026-11-18；其公開端點、OCI 主機和瀏覽器沒有在當日重查。較早的現況文件只保留其各自快照，不能當成最新 repo 狀態。後續工作的最新狀態須從各 repository 的 `main`、CI、部署 revision 與實際驗收更新；舊快照不得覆蓋新證據。

相關交付文件：[Construction map](CONSTRUCTION.md)、[Handoff](HANDOFF.md)、[Harness](HARNESS.md)。

## 1. 範圍與交付現況

交付範圍包括 Portfolio 主站、MES、ERP、POS、CRM、餐飲與 Shop/Commerce 六個領域，並涵蓋中央展示站、六個獨立系統 repository、Web 發布，以及 MES/ERP/CRM Windows client-server。這幾種交付面有不同身份、資料庫與版本，必須分別驗收。

目前已存在可操作的 Web/Workers/D1 應用、中央 Go 工作站、六套獨立 Go repository 及 React UI、各系統 migrations/CI、部分 OCI 部署工作流和 MES/ERP/CRM 桌面包裝。這不代表所有原始需求均完成，也不代表每個 repo 最新 main 已部署到公開路由。

已具體確認的交付例子：Portfolio 部分效能、分頁與資源生命週期改善已合併；MES/ERP/CRM 已有部分交易及桌面建置/身分改造。POS 的 2026-11-18 遠端 `main` 快照為 P01–P06 已有合併實作，PR #18 小票重印已合併，PR #19 有 gated P07 consumer identity foundation；P07 的 email、checkout 關聯、交易歷史與公開路由尚未完成。P04 `b475381` 私有 OCI revision 曾通過 host health，但不是本日主機驗收。POS 公開 DNS/TLS/外部瀏覽器入口仍未驗；其他系統的合併或映像 CI 也不等於部署完成。完整細節與日期以各記錄為準。

全案應使用以下狀態詞，禁止混用：

- **已實作**：程式碼已存在；如無測試或部署證據，仍不得稱已驗收。
- **CI 通過**：指定 commit 的指定工作流通過；只適用該 commit 與該工作流。
- **已部署**：指定環境回報的 release revision 與目標 commit 相符。
- **API/服務驗收**：健康、授權與必要的交易/API 檢查有證據。
- **使用者流程驗收**：實際瀏覽器/Windows 裝置走完指定交易並核對持久化及結果。
- **待輸入**：缺少需由系統/帳戶/主機管理者提供的明確外部設定或授權，不能用程式更改替代。

## 2. 執行順序與依賴關係

### P0 — 建立可依賴的版本與交付基線

1. 每項工作先指定唯一目標：`profolio`、獨立系統 repo、中央 station、Web/Workers 或 Windows client-server。確認目標 repository、最新 `main` SHA、對應 PR/head、CI workflow 和環境。中央工作站的功能不可當作獨立 repo 已完成。
2. 對照本文件、原始規格、system tests 和最新開發審計。整理 acceptance case、資料影響、身份/租戶邊界、回滾條件及必要運維輸入；先補架構與測試再實作。
3. 將新交付紀錄格式化：repo、commit、環境、CI run、發布時間、服務回報 revision、健康檢查、瀏覽器/裝置證據、已知限制和 rollback 結果。只改該次具備證據的狀態。

**Gate P0：** 目標 repo/branch/SHA、接受條件、依賴及回滾明確；沒有舊文件或另一 repo 的 CI/健康結果被拿來替代。

### P1 — 補足各領域業務功能與自動化驗收

按下方每系統清單逐條完成尚缺交易與 UI。主要交易以整數金額、伺服器端權限、租戶隔離、狀態機、資料庫交易、冪等與 audit 設計。高風險轉移需有負向、失敗回滾、重送與實際並發測試。測試依原系統技術執行，至少包含格式/靜態檢查、單元/整合測試、migration 契約和 build；關鍵流程另做 browser/API 驗收。

**Gate P1：** 選定的 acceptance case 通過；測試涵蓋成功、越權/錯誤輸入、重複請求、競爭寫入、交易中途失敗及重啟持久性。沒有跨租戶資料暴露或不一致帳務/庫存。原規格不適用或刻意縮限者，明示為產品限制。

### P2 — 整合身份、資料與共享流程

1. 明確領域權威：MES 為製造與批號、ERP 為正式商品/庫存/財務、POS 為門市銷售、CRM 為客戶與商機、Dining 為桌位/廚房/餐飲單據、Shop 為線上通路訂單；各來源不可並行直接寫彼此資料表。
2. 需要跨域資料時，定義版本化事件/契約、來源及目的端 ID mapping、冪等鍵、排序/重播、退回與人工衝突處置。中央站的既有 MES→ERP 整合或 portfolio hybrid-sync 工作，只能證明其所測路徑，不代表六個獨立 repos 已互通。
3. 對 legacy demo/正式資料做唯讀盤點、擁有者與租戶映射、來源凍結策略、隔離 staging、雙向關聯驗證、筆數/金額/數量/庫存/帳務核對、重試/中止和 rollback 演練。維持源資料直到明確驗收與核准切換。

**Gate P2：** 每個遷移批次有完整來源快照、映射表、差異報告、重複執行安全、恢復方法與核准記錄。不可由 demo cookie 或 seed user 推定資料所有權。若所有權未確定，維持舊來源服務，不公開切換該資料集。

### P3 — 發布、部署與公開路由

1. 先在每個目標 repo 對最新 PR head 跑其自身 CI，review 精確 head，合併到該 repo 的 `main`。發布映像/Artifact 後記錄 digest/SHA。
2. 先部署隔離或私有候選。備份資料，套用可回滾 migration，健康檢查須確認正確 revision、資料庫、登入拒絕/允許、主要交易與日誌秘密清潔。
3. Web 逐站核對外部 DNS、TLS、入口 upstream、未授權拒絕、版本 API 和至少一條角色化核心流程；逐站分開更新狀態。已存在共享主站或同一 hostname 不構成獨立站已驗收證據。
4. 發布失敗時依該站 runbook 回復前版程式/路由；資料 schema 需有相容回復或明確資料復原方案。不能刪除 volume 以達回滾。

**Gate P3：** repo/main commit = CI SHA = artifact/image revision = host health revision；資料完整性與回滾已演練。外部路由切換需依明確 maintenance window/核准條件，並在切換後從站外再驗 HTTPS、登入、核心流程及錯誤回復。

### P4 — 完成角色化 UI、裝置、維運與交付

逐系統完成前/後台、角色、英文/繁中（依產品要求）、桌機/手機、無障礙、列印/標籤，以及資料重啟/備份/還原操作。MES/ERP/CRM 另在真實 Windows 測試機完成打包安裝、啟動、身份隔離、client-to-local-server、資料路徑、更新與復原；CI 的 Windows build 不算使用者裝置驗收。POS、餐飲、Shop 桌面版本不在目前明確交付範圍。

**Gate P4：** 逐角色操作核心流程和拒絕條件；確認列印資料正確、不重複建立紀錄；不同裝置尺寸無非預期溢出；安裝、更新與 rollback 有記錄。外部金流、郵件、物流或實體硬體只有在另有 adapter、憑證管理及實際 sandbox/設備驗證後才可標為串接完成。

## 3. 逐系統待辦與驗收門檻

以下系統清單是依各來源的不同日期整理：較早的 repo/CI/部署待辦快照約截至 2026-11-15；系統狀態欄如 POS 已採用 [HANDOFF.md](HANDOFF.md) 於 2026-11-18 查詢的遠端 `main`/CI。Handoff 當日未重新核查公開端點、OCI 主機和瀏覽器。開始每項前重新核對目標 repo 最新 `main`、PR/CI 與環境；如已完成就附最新證據並關閉該項，勿重做或沿用過時狀態。

### Portfolio / profolio

**已交付或已合併證據：** Portfolio 首頁、六系統入口、語系/特效工作、部分長期資源生命週期及表格分頁；既有私人備份/使用者金鑰程式、hybrid sync 和 Rust 桌面 supervisor 程式。已記錄過 main CI/OCI 部署及 browser 例子，但 live endpoint 快照日期早於此基準日，須刷新。

**優先待辦：**

1. 合併/重新驗證首頁效能與待整合變更；用精確 main SHA 取得新的工作流及部署 revision。保留瀏覽器 WebGL fallback/reuse、閒置停繪、語系持久性、直接深連結及返回行為的測試；不宣稱未測裝置 FPS。
2. 完成訪客/私有 owner 身份交接：應用正式 Google OAuth provider 設定、初始化實際 owner、測試既有帳號登入、跨使用者/工作區備份金鑰 scope、配額/過期/撤銷及還原授權。Client ID/Secret 僅透過受控機密設定面提供，不放進 Git、對話、文件或日誌。設定之前保留程式可部署但正式 OAuth 未驗狀態。
3. 刷新現行主站 health/revision 和 portfolio/Web 資料備份、還原 evidence；測試備份權限、同工作區還原、損壞輸入拒絕、交易原子性、limit 和日誌清潔。
4. 完成六站完整 browser/role/mobile/print QA、中央 Go 演示併發展示 UI 與停止狀態；更新入口與 repository 對照。

**驗收：** 公開訪客無法使用私人備份/匯出；真正 owner 登入和 Google callback 成功；合法 key 僅可下載核准 workspace/scope 且撤銷生效；部署 health 回報 main commit；所列 flows 有 browser session 記錄。

### MES / ForgeFlow

**已交付/狀態快照：** 獨立 Go 有工單報工、批次、用退料、品質、停機、成品和 ERP mapping/receipt 等合併項；Windows supervisor/CI 與 OCI/路由材料存在。BOM revision 等有已審計的 PR/local browser evidence；部署、正式資料、完整瀏覽器和 Windows 使用者流程仍需依最新審計核對。

**待辦：**

1. 完成 BOM/途程版本設計及最新待合併 change。驗證 BOM v1 被工單固定引用；發布 v2 不改舊單；多層循環拒絕；物料成本/數量正確。
2. 完成主流程：BOM→工單→領料/批號→開工→良品/報廢報工→品檢放行/隔離→成品批次入庫→結案；檢查重送無重複、超量/缺料/未放行均拒絕、批號雙向追溯及 ERP 收貨/庫存 mapping。
3. 補足排程、工作中心超排權限、重工放行、維修及設備停機完整區間。固定 OEE fixture 的 A/P/Q/OEE 應為 75%/83.333…%/90%/56.25%；零分母應回報無資料，不以合成展示冒充工廠設備訊號。
4. 依 [MES production migration](engineering/MES_PRODUCTION_MIGRATION.md) 完成 identity enrollment、source/target reconcile、隔離 OCI/公網路由與 rollback；完成 Chrome/手機/列印和 Windows 安裝連線驗收。

**驗收：** 保存完整工單單據鏈和批號、總耗量/成品/ERP 入庫一致；未授權使用者不可放行；故障或重放無重複庫存/報工；部署後 health revision 相符。

### ERP / LedgerWorks

**已交付/狀態快照：** Go 版採購/核准/收貨、銷售/出貨、stock transfer、purchase return、billing/payment、balanced journals、stock count 等已有獨立 repo 合併工作；Windows identity/desktop CI 有資料。完整獨立 OCI、公開路由和 Windows 客戶端仍需逐層核實。

**待辦：**

1. 完成並驗證 fiscal period close PR/功能（若最新 main 尚未合併）；拒絕關帳期回寫，過帳/稽核同一交易，跨時區日期邊界正確。
2. 補完整會計與業務鏈：採購核准→部分/完成收貨→應付/付款；銷售→部分/完整出貨→應收/收款；調撥與盤點核准；退貨反向台帳；總帳平衡、沖銷、成本與來源鑽取。明確揭露簡化會計未等於法定財稅。
3. 先跑 production-safe rehearsal：對既有 1,609 個 ERP demo workspace 的快照資料，先解決正式所有權和帳號映射。未驗身份/逐列映射時，維持 ERP shared route，勿將 legacy records 匯入新租戶或公開切換。
4. 完成獨立 runtime 的持續性、備份、還原、服務回滾、HTTPS/授權/browser flows 和 Windows 安裝/登入/隔離。

**驗收：** 庫存流水和彙總一致、調撥守恆；借貸平衡；未授權跨 tenant 引用拒絕；退貨與成本反向紀錄完整；目標 release health revision 相符，回滾後資料不丟失。

### POS / CounterPoint

**已交付/狀態快照（2026-11-18 遠端 `main`：`f8897c5967fbd78834422cf103f668c109fddd08`；workflow [43880345013](https://github.com/Davis1233798/business-suite-pos/actions/runs/43880345013) 成功）：** P01–P06 已有合併實作，包括收銀/掛單、退款與班次現金差異相關範圍（PR #15/#16）；收銀員小票重印 PR #18 已合併。P04 的 `b475381` 私有 OCI 部署 revision 曾通過 host-side health，但該證據較舊、此次未重查，不能代表目前線上 SHA。P07 會員身份有架構文件及 PR #19 gated consumer identity foundation；該 foundation 未含 email delivery、checkout 關聯、交易歷史或公開路由，production routes 明確 hard-disabled，不能稱會員流程已完成。公開 DNS/TLS/路由及外部 browser 本次未驗。遷移政策不支援匯入未結 open shift，須在來源端先處理，不可自動關班。

**待辦：**

1. 依 P05/P06 已合併程式補全逐情境行為與整合驗收：原單退款/折扣分攤/庫存回補/權限/收據/稽核/冪等、現金異動和班結差異。不要把 PR 合併等同所有退費和 shift edge cases 已驗收。
2. 完成 P07：把架構文件與 gated foundation 擴成明確身份/會員註冊或綁定政策、checkout/order 關聯、可授權交易歷史、郵件驗證或其他驗證通道、隱私/保留、重送與停用；只有在產品/安全接受條件明確後才解除 hard-disabled production routes。另驗證 #18 重印授權、原票關聯與不重複建單。
3. 固化 register shift invariants：每 register 同時只有一個 open shift；不可自動關閉未結班；sales/refund/cash movements 必須歸屬正確 shift 和 user；UI/API 日報一致。Migration 遇到未結 shifts 必須停止並由來源操作者處理，明確映射 cashier、locked_by、user refs，不 fallback admin。
4. 先唯讀核對私有 POS host 的 current SHA、health、資料與備份/rollback，不覆蓋另一站 volume。公開路由另核 DNS/TLS/access 並完成外部 browser 流程後才標已上線；私有部署和 PR/CI 綠燈皆不足以證明公開可用。
5. 維持線上收款為受控流程，不宣稱正式離線收銀；若將來支援離線交易，另設計防重、衝突、現金結算與同步模型。

**驗收：** 掛單只能取回/結算一次；同 key 重送至多一筆；折扣後退款、原交易/shift/支付/庫存/小票/日報全數守恆；同 register 雙開班原子拒絕；會員流程的身份驗證、checkout/order 綁定、歷史授權、停用及無驗證資料拒絕均有測試；公開入口外部驗收再標已上線。

### CRM / RelationDesk

**已交付/狀態快照：** Go 版線索 qualification/conversion、opportunity stage、租戶/角色/擁有者/稽核/冪等已有獨立 repo 合併證據；SQLCipher 與部分 encrypted export、Rust supervisor/Windows CI 有記錄。CRM 其他中央版流程未必已移植；正式 OCI/Windows 實際遷移及復原未完成驗證。

**待辦：**

1. 補齊聯絡人/公司去重與合併審批、擁有者/團隊資料範圍、活動提醒、報價多品項版控、客服 SLA/暫停/重開/假日行事曆及同意撤回。
2. 對敏感欄位、PII 匯出、稽核與 CSV 權限做跨 tenant 和角色化安全測試；報價核准後內容不可被靜默改寫。
3. 驗證 SQLCipher 新庫初始化、既有資料版本遷移、加密快照、備份密碼/DPAPI 綁定、失敗 restore atomicity、復原流程和 Windows 使用者切換/換機限制。CI 可通過不代表真實 user database 已經成功遷移。
4. 完成獨立 Web runtime/路由和瀏覽器驗收；未設定真實 OAuth/owner 時，明確保留待輸入而不假稱 SSO 完成。

**驗收：** lead concurrent conversion 只建一個客戶/聯絡人/商機；撤回同意立即排除行銷列表；跨租戶查詢/列印/匯出拒絕；加密 backup/restore 前後資料、授權與稽核如規格一致。

### Dining / TableCraft

**已交付/狀態快照：** 獨立 Go repo/workflow 已存在；中央演示涵蓋桌位/預約/菜單加點/KDS/結帳/外帶等部分流程。獨立站部署和完整 browser 流程未由此證明。

**待辦：**

1. 完成桌況/預約容量與時段衝突、菜單規格/停售、order ticket、KDS 順序/催單、退菜與分單收款全鏈。交易請求需冪等且同一桌不得競爭建立兩個有效訂單。
2. 補全預付外帶建立/取餐/取消/退款、支付後退款反向紀錄、服務費分攤與營收對帳；明確訂位時長與台北時間邊界。
3. 實測桌面/手機操作、KDS 大屏、列印票據/條碼與錯誤重試。外部 QR、簡訊/通知、刷卡機均屬缺 adapter/credentials 的外部整合，分開列項。
4. 獨立服務做 migration/備份/復原、CI、private candidate 和公開路由驗收。

**驗收：** 同桌並發下單/結帳不超賣或雙重扣款；拆單金額及服務費加總一致；已付款訂單重送不重複扣款；取消/退款留下原單反向連結；KDS 狀態與票據可追溯。

### Shop / MarketLane Commerce

**已交付/狀態快照：** Shop 獨立 repo 有 Go storefront/checkout、coupon、shipment 和 return/refund 等合併工作；portfolio 另有整單結帳/模擬付款流程。商店映像/CI不代表 OCI 上線；原有 15 筆以上非 seed legacy orders 需要 owner/tenant reconcile，維持原資料來源直到驗收。

**待辦：**

1. 驗證 catalog/variant/price/stock、購物車、coupon tenancy、checkout、付款狀態、Outbox fulfillment、shipment、return/refund 端到端；測跨租戶 coupon/地址/訂單拒絕、過期庫存釋放、晚到付款拒絕/人工核對和冪等重播。
2. 目前模擬金流與出貨維持清楚的 mock adapter；真實付款/物流只能於 provider sandbox、signature/replay、timeout/reconcile 和退款流程驗收後啟用。
3. 完成手機瀏覽器、訂單查詢、分頁/篩選、地址快照/PII、CSV/報表、備份/復原/部署和 rollback。
4. legacy 訂單先在隔離 staging 做身分/租戶映射、逐單及淨營收/存貨核對；未完成前保留 shared route/原資料，不能只複製訂單表後公開切換。

**驗收：** 同庫存只剩一件的多 request 競爭只有一筆結帳成功；付款事件/庫存 reserve/釋放/出貨/退款唯一且有關聯；可計算小計、折扣、運費、退款、淨營收一致；獨立 store 的客戶與訂單不跨租戶可見。

## 4. 跨系統同步與所有權規則

1. **先確定權威系統。** ERP 持有正式 inventory/cost/accounting ledger 時，POS/Dining/Shop 各自只能有其通路訂單與局部 reservation；MES 以批次/工單/品質事件回報成品供應。不要讓每個 UI 直接調整 ERP 表。
2. **使用明確整合契約。** 每個事件寫明 producer、entity ID、schema version、occurred/recorded time、idempotency key、tenant、因果版本與處理回覆。資料傳輸必須可重送且消費端交易內去重。
3. **決定衝突處理。** 庫存不可用 last-write-wins 合併絕對值；採權威 ledger 事件/數量 delta，未能確定順序時進 reconciliation queue，保留 source record，由有權限操作員處理。
4. **所有跨系統關聯具穩定映射。** 商品 SKU、warehouse、supplier/customer、MES lot/work order、ERP receipt、POS/Shop order 必須有可稽核 mapping。未映射資料拒絕/隔離，不得 fallback 到 admin 或共用 seed ID。
5. **定義時間與金額。** 金額整數 TWD，UTC 儲存、Asia/Taipei 顯示，日結需固定站點 business date；退款/沖銷用新的反向事件，不覆寫原交易。
6. **分階段推出。** 先只讀 projection → staging replay/reconcile → 小流量核准 writeback → 指標與人工 fallback → 擴大流量。每一階段有停止條件、滯後/錯誤/重播 dashboard 及 reconciliation owner。

完成定義：重放不重複出貨/扣庫/入帳；隨機抽查 source-to-destination 數量、金額、成本/批號關聯相符；停擺可恢復且不遺失 outbox；對帳差異可指向原始事件與處理人。

## 5. 每個 PR 與發布的標準 gate

每個 change 至少檢查：

- **設計/範圍：** 正確 repository 和產品面；程序狀態圖、資料 ownership、權限、失敗/重試/並行及 rollback 已說明。
- **測試：** 新的業務不變量有可重現測試；migration 測 fresh DB、前版 DB、失敗中止/rollback；測試不把單機序列呼叫冒充併發。
- **程式/CI：** lint/type/build/tests；Go race 如適用；Windows/ARM64/CI workflow 依支援矩陣；PR 用 exact head SHA 檢查，不以舊 run 通過作證。
- **資料安全：** 沒有密碼/token/個資；跨租戶/角色拒絕；查詢/匯出同樣授權；正常/錯誤日誌不洩露 secrets。
- **發布：** 備份、migration 相容性、artifact digest、revision health、readiness、外部路由/拒絕存取、rollback 記錄。
- **實際流程：** 瀏覽器/裝置做真實輸入，刷新/restart 後核對持久資料與總額；記錄 OS/尺寸/瀏覽器/repo/SHA/環境時間。

只有達到相應層才更新該層狀態。不執行不相關整套測試；按變更範圍跑必要檢查並報告限制。

## 6. 外部運維輸入與程式待辦分流

### 可以由 repo 工作繼續完成

- 未完成交易/API/React 表單、migration contract、race/retry/failure tests、備份/restore 工具、CI workflow/health revision、部署 rollback 腳本、runbook、browser 覆蓋及安全日誌。
- 對既有資料製作只讀盤點/隔離轉換器與差異報告；設計 staging 不會等同允許修改或切換正式資料。
- 對可在現有授權內執行的 localhost/測試 fixture 做完整驗收，不把它冒充正式環境。

### 需要環境管理者提供/完成，須明確標成等待輸入

- Google OAuth Web client/secret 與正式 callback domain 設定、真實 owner 私下初始化/驗收。憑證不可貼入 chat 或提交 repo。
- 對應 OCI / DNS / TLS / gateway / SSH/Actions 部署權限和 maintenance window；若服務缺乏權限，先完成程式、workflow、host inspection plan，再記錄具體無權項目。
- Legacy workspace/訂單資料的真實所有權確認、身份/租戶映射審核及資料切換簽核。seed cookie/使用者不能推定 ownership。
- 真實外部 payment/mail/shipping/tax provider sandbox、測試帳戶、webhook secret/回呼及法遵條件；真實 QR/掃描器/印表機/工業設備和操作員可用時間。
- MES/ERP/CRM Windows 驗收機及指定使用者資料遷移/恢復介入；只能由具備資料/憑證權限的 operator 提供真實 inputs。

外部輸入尚未到位時，不停止可獨立完成的程式和合成/隔離驗收；也不得虛構設值、模擬成功或觸碰他人系統資料替代之。

## 7. 來源與快照限制

- 原始需求與規格：[PLAN.md](PLAN.md)，包含完整系統模組/業務案例與初始架構；它是需求，不是現況。
- 現況待辦與 release boundaries：[ACTIVE_DEVELOPMENT.md](ACTIVE_DEVELOPMENT.md)，主要 GitHub/CI/POS 私有 OCI 證據更新到 2026-11-12；晚於此日的分 repo 狀態以本日 [HANDOFF.md](HANDOFF.md) 遠端查詢為準。
- 更完整部署/資料/UI/Windows 待辦：[DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md)，證據更新到 2026-11-15；Portfolio endpoint snapshot 為 2026-11-04，不能視為 2026-11-18 即時證據。POS 本日遠端 main/CI 詳見 HANDOFF；POS host revision、公網入口與瀏覽器仍未於本日重查。
- Web 舊版功能細項與測試檔：[ACCEPTANCE.md](ACCEPTANCE.md)，其主要系統矩陣基於較早的 2026-10-30 Web/TypeScript 版本；不能直接用它推論新版獨立 Go station。
- 舊目標稽核及歷史架構：[engineering/GOAL_AUDIT.md](engineering/GOAL_AUDIT.md)、[engineering/GO_REACT_DESKTOP.md](engineering/GO_REACT_DESKTOP.md)。其中早期部署/網域說法可能與後續紀錄矛盾；使用較新可驗證主機/CI/外部觀測，重新標註過期內容。
- 獨立 repo latest status 需查每個目標 repo 的 PR、`main` workflow、artifact、host release pointer 和 `/api/health`。本文件不冒稱在此次文件工作中已重跑所有遠端檢查。
