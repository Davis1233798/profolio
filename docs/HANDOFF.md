# Business Suite 交接手冊

> 證據基準：2026-11-18（台北時間）。GitHub 目前 `main` SHA、最新主分支 workflow、PR head/check 與 GitHub Deployments API 已於本日重新查詢；公開端點、OCI 主機和瀏覽器本次未重新連線，因此凡無當日直接證據均標為「未知／待核」。
>
> 建置地圖與完整來源樹請先讀 [CONSTRUCTION.md](CONSTRUCTION.md)；工作排序與建議驗收步驟見 [DEVELOP_PLAN.md](DEVELOP_PLAN.md)；工程邊界與驗證流程見 [HARNESS.md](HARNESS.md)。兩份文件已在本次建置分支的工作樹中提供，預計和本交接一同提交；目前尚未包含於 `origin/main`。合併前請以本分支版本為準。

## 狀態用語

- **已驗證**：有日期、commit/run/PR 或具體測試證據。它只代表被測層級。
- **部分**：有程式、測試或部署證據，但仍有後續門檻。
- **未知／待核**：本次沒有足夠即時證據；不可從文件舊快照或 CI 推定線上狀態。
- 公開 repo 的 PR/CI、image publish、OCI 私有部署、DNS/TLS/公開路由、資料遷移、瀏覽器端到端和 Windows 實機安裝是不同驗收層。

## 優先處理：目前阻擋項

| 優先 | 系統／工作 | 目前證據與阻擋 | 下一位負責者的動作 |
|---|---|---|---|
| P0 | Portfolio 發版路徑與 POS P07 交接，[PR #59](https://github.com/Davis1233798/profolio/pull/59) | **已解決並合併至 main** (`b9788a6`，2026-11-18)。已比照 `mes_public_route.py` 修復 `infra/linux/erp_public_route.py` 可選引號（雙引號/單引號）enum 解析與驗證，並於 `test_erp_public_route.py` 補足 quoted/unquoted 測試。web、infrastructure、station-delivery、Windows desktop、k6 checks 全數通過。release 路徑與 route parser 阻斷已解除。PR 本文之 POS P07 維持設計起點，會員關聯實作與驗收仍列單獨待辦。 | 依計劃推進下一階段發布與外部路由演練；POS 團隊依獨立驗收標準接手 P07。 |
| P0 | CRM API ownership，[PR #13](https://github.com/Davis1233798/business-suite-crm/pull/13) | **已解決並合併至 main** (`7c80ab6`，2026-11-18)。查明根因為 MSYS2 UCRT64 升級 OpenSSL 4.1.0 導致動態 DLL 檔名為 `libcrypto-*-x64.dll`；已修正 `.github/workflows/crm.yml` 及 `scripts/package-desktop.mjs` 改採動態解析複製。重跑後 Linux 與 Windows desktop checks 皆成功綠燈，publish 產出 Windows 產物。PR 變更非管理員對商機與關聯報價、活動讀取/列印的 owner 限制；沒有 schema、live DB 或部署修改。 | CRM 維護者依規範執行後續聯絡人去重與資料範圍授權。CI 綠燈不代表既有 Windows 安裝或正式資料遷移完成。 |
| P0 | Shop private OCI candidate，[PR #19](https://github.com/Davis1233798/business-suite-shop/pull/19) | **已解決並合併至 main** (`867e84f`，2026-11-18)。查明根因為 candidate network 設置 `internal: true` 導致 Docker 阻斷 127.0.0.1 本機 published port 轉發；已移除 bridge 上的阻斷設定並補強 matrix `fail-fast: false`。重跑後 `shop (ubuntu-latest)`、`shop (ubuntu-24.04-arm, -arm64)` 與 PostgreSQL transaction verification 三項檢查全數成功綠燈。 | 接續進行 Shop 候選映像私有主機部署驗收與資料核對；不可把 workflow prep 宣稱成已部署。 |
| P1 | MES production migration/cutover | Runbook 指 MES 操作者負責 source/target reconciliation；Portfolio 操作者負責 Caddy mode 與 route rollback。需先在 maintenance ticket 指定兩人。文件仍列 production snapshot rehearsal、account enrollment、public route switch 為 outstanding；本日未重新查主機/公網。 | MES 操作者盤點獲准 organization IDs、帳戶與 grants，建立實際來源／候選一致備份及 digest，在隔離位置演練匯入和業務核對；Portfolio 操作者核對 root-owned ingress socket、route 和 rollback。凍結寫入前須雙方具名，公開切換前驗登入、revision、只讀資料與回退。詳見 [MES_PRODUCTION_MIGRATION.md](engineering/MES_PRODUCTION_MIGRATION.md) 和 [MES_PUBLIC_ROUTE_CUTOVER.md](engineering/MES_PUBLIC_ROUTE_CUTOVER.md)。 |
| P1 | ERP routing 與既有資料門檻 | ERP `main` 已有私有 production deployment record（SHA `4de38f1366befc2d5fc66123065f35dbce11b4de`，2026-11-13）。不證明現今 host revision、data import 或 public route 已核驗。部署記錄指出公開 ERP route 須等獨立資料與使用者驗證；既有 legacy ERP 資料要先確認所有權和帳戶映射。 | ERP 操作者驗私有 health/revision、帳戶/tenant 與資料持續性；完成 legacy inventory reconciliation 和回滾演練後，依 [ERP_PUBLIC_ROUTING.md](engineering/ERP_PUBLIC_ROUTING.md) 驗 anonymous reject、登入、revision，再由 Portfolio 操作者切換。ERP `main` 最新 CI [run 43431087289](https://github.com/Davis1233798/business-suite-erp/actions/runs/43431087289) 成功；其前一 commit run 43431079289 失敗，不能以舊 failure 取代 current SHA 結果。 |

## 分系統未完成工作與目前交付證據

> 遠端 `main` SHA 與最新 workflow 是 2026-11-18 查詢值。GitHub Deployment 一欄只表示 GitHub API 是否有部署紀錄，不等於其他渠道部署不存在；未知狀態需直接核主機、外部 HTTPS、health/revision、使用者流程。

| 系統 | 當前遠端來源／CI | 部署與驗收缺口 | 接手下一步 |
|---|---|---|---|
| Portfolio / 中央站 | `profolio/main` `b84eaa94b81a71f54b93b30ca207d907745748cf`；PR #59、#61（含 erp route parser 引號修復與測試）已合併；main workflow [44250448495](https://github.com/Davis1233798/profolio/actions/runs/44250448495) checks 成功。 | DEVELOPMENT_STATUS 的主站 health/revision 證據日期是 2026-11-04，不能當本日 live proof。owner bootstrap、實際 workspace 身分與 Google OAuth callback 尚待私下設定/驗證（OAuth與owner延後是既定邊界）。中央 Go、Workers web、獨立站和各資料庫彼此分離。 | PR #59 parser finding 已修復並合併；之後 read-only 核主站 release pointer、`/api/health` SHA、資料庫 health、anonymous backup/export/restore拒絕，再做 admin account/key/revocation/restore 的真實授權測試。Secrets 不得寫 repo/issue/聊天。 |
| MES / ForgeFlow | `business-suite-mes/main`<br>`2867f8f492c745c4b6d1041183aea4d47e6dc551`；PR #21 已合併；CI run [44261814219](https://github.com/Davis1233798/business-suite-mes/actions/runs/44261814219) 全綠通過（Linux、Windows、Rootless）。 | public hostname、當前 rootless/route、真實 production migration rehearsal、account enrollment 本日未知/待核。已完成多工序追加、完工量依最高報工工序累積、全單報廢守恆、M08 OEE 基準（56.25%）與零分母防護。 | 依 `MES_ERP_INTEGRATION.md` 設計成品入庫與 ERP 庫存映射之 Outbox 事件契約；按 MES runbook 進行實際來源備份與候選資料庫的批號/庫存無損對帳演練。 |
| ERP / LedgerWorks | `business-suite-erp/main`<br>`e6eeef81b0df1e654c2d5953a33839b77ff0c79b`；PR #22 已合併；CI run [44280955131](https://github.com/Davis1233798/business-suite-erp/actions/runs/44280955131) 全綠通過（Linux、Windows、Rootless、Release）。 | 關帳防竄改已完成（經辦員/管理員關帳權限、已關帳期間嚴格禁止寫入傳票/發票/付款/盤點調整 409、跨時區台北 UTC+8/UTC 邊界檢查）、底層觸發器防負庫存（`balance_after >= 0`）、調撥守恆（$\sum \Delta Q = 0$）、E08 移動平均成本均已綠燈驗收。公開 route 與 1,609 個 demo workspace 所有權映射仍需分開驗收。 | ERP 操作者於隔離 staging 環境核對採購/分收、銷售出貨/成本、調撥、退貨、應收付、傳票、盤點/關帳；完成 legacy inventory reconciliation 和回滾演練後，依 [ERP_PUBLIC_ROUTING.md](engineering/ERP_PUBLIC_ROUTING.md) 驗 anonymous reject、登入、revision。 |
| POS / CounterPoint | `business-suite-pos/main`<br>`480e3e0a0c5392209cc99031a4b5d035ea62cc32`；PR #20 已合併；CI run [44256358163](https://github.com/Davis1233798/business-suite-pos/actions/runs/44256358163) 雙平台全綠通過。 | 公網 DNS/TLS/外部可達性未驗。P01–P06（收銀/掛單/退款/班結/小票重印）與 P07 會員消費者配對、結帳交易關聯綁定、Outbox 交易事件同步與租戶隔離已全數實作並綠燈合併。migration policy 不支援 open-shift 匯入。 | POS operator 在私有 host 核最新 SHA；跑 shift open/close、barcode、sale、hold/retrieve、refund、receipt reprint、consumer pairing 整合驗收。open shifts 先在 source resolution。公開 route 需另行審核。 |
| CRM / RelationDesk | `business-suite-crm/main`<br>`ba8b4c1b3c777e5086b27065203ef9e9eb9d8adb`；PR #14 已合併；CI run [44276769529](https://github.com/Davis1233798/business-suite-crm/actions/runs/44276769529) 全綠通過（Linux、Windows、Publish）。 | PR #13 與 PR #14 皆已完成合併；R06 台北客服 SLA 週末自動跳過、潛客重複檢測（email/phone/taxId）與審批合併（筆記與活動保留）、重複轉換防護（409）、GDPR 同意撤回即刻排除行銷清單已驗證通過。正式 OCI/Windows 實機遷移待驗。 | 對 lead `assigned_to`、account/activity/opportunity `owner_id` 建立明確 user mapping 與有效 back-office grants；Windows 驗 SQLCipher DB、啟動/更新/復原與登入。 |
| Dining / TableCraft | `business-suite-dining/main`<br>`62c039bbedd9c72e3c6b2f967a5d24a50a9c5a7b`；PR #9 已合併；CI run [44264586106](https://github.com/Davis1233798/business-suite-dining/actions/runs/44264586106) 雙平台全綠通過。 | route/revision 本日未知；已完成桌位 90 分鐘預約重疊衝突拒絕（409）、KDS 單向出餐狀態機（`received`→`cooking`→`done`→`served`）、D07 服務費拆單結算守恆（100+200，10% 服務費=30，總額 330）與退款反向台帳。 | Dining operator 核現在 host/route/revision；測 reservation conflict、open table、multi-item orders、KDS transitions、split settlement/refund、營收對帳及重送/並行。核實 offline workspace import 在主機的備份與回復。 |
| Shop / MarketLane | `business-suite-shop/main`<br>`1be561be96f8f1d3fb7bff5a8e640dd9218012e2`；PR #20 已合併；CI run [44270950993](https://github.com/Davis1233798/business-suite-shop/actions/runs/44270950993) 全綠通過（Linux、ARM、PostgreSQL 交易驗證）。 | private OCI candidate 未部署；已完成 S04 優惠券餘數倒序分攤與配額原子扣減、結帳防超賣並發保護（409）、退貨退款反向台帳、PostgreSQL 遷移測試相容。模擬 payment/shipping 為 mock。 | 接續進行 candidate isolation/digest/recovery 私有主機部署測試；針對 15 筆以上 legacy orders 於 staging 執行租戶與帳號映射演練；端到端測 catalog/coupon/checkout/refund 不變量。 |

## 跨系統資料遷移與身份責任

**目前資料庫不是一套共用資料庫。** Workers web D1/SQLite adapter、portfolio central Go SQLite、各獨立站 SQLite、Windows local data 各自分離。不得因共用網域/OCI/桌面入口便推定帳戶、租戶、transaction 或資料會同步。先指定來源/目的系統、組織ID、資料版本、operator，再做匯出與映射。

- Legacy demo workspace ID `org_<demo_session_id>` 與 station workspace ID `org_test_<suite_demo_space>` 不同；cookie/session 不是身份證明或授權，禁止依相同瀏覽器 session、email 字串、訂單 metadata 自動認領。目的 workspace 必須由已登入 station admin 明確選擇。
- 匯入檔是不可信輸入。寫入前完整驗表/欄位 manifest、來源 organization、型別、重複 ID、業務不變量、外鍵/跨表引用；列出來源/目的、數量、衝突與 unmapped identities。目的資料先備份；apply 必須 atomic、audit、可重複、安全拒絕，失敗不留部分寫入或暗中覆蓋。
- 需明確映射的欄位至少包括：MES production report `operator_id`；CRM lead `assigned_to`、account/activity/opportunity `owner_id`；POS shift/sale `cashier_id`、held cart `locked_by`；Shop cart/order/review `user_id` 和已知 legacy demo user 的 reservation `session_id`。CRM assigned user 要有啟用的 CRM back-office grant。不可把所有人映射成 admin。
- Legacy export 不包含 users/memberships、audit、idempotency、outbox、seed state；歷史稽核和 pending integrations 需另訂處理，不能宣稱已遷移。POS open shifts、claimed held carts、active commerce reservations、pending/failed-payment orders、unfinished returns 目前在隔離 staging 必須拒絕；先回 source 將狀態處理到政策允許，再重新匯出。不得自動取消、結班或改原始交易。
- 真實 acceptance 必須拿到已核准的多表 workspace，含 linked transactions、非預設帳戶、現存/歷史資料；核 counts、money totals、stock balances、外鍵、tenant isolation、前後台/owner visibility、duplicate import、invalid data/interruption rollback 與 rejection 時 destination 不變。fixture-only CI不算真實來源核對。
- Windows SQLCipher/DPAPI、device identity、離線 restore與跨 Windows user recovery需逐系統實機驗；打包和 CI只證明 artifact/test層。

詳細規範：[LEGACY_WORKSPACE_MIGRATION.md](engineering/LEGACY_WORKSPACE_MIGRATION.md)、[LEGACY_OFFLINE_IMPORT.md](engineering/LEGACY_OFFLINE_IMPORT.md)、[LEGACY_IMPORT_COMMAND.md](engineering/LEGACY_IMPORT_COMMAND.md)、[LEGACY_RESTORE_COPY.md](engineering/LEGACY_RESTORE_COPY.md)、[WINDOWS_MIGRATION_SNAPSHOT.md](engineering/WINDOWS_MIGRATION_SNAPSHOT.md)、[GO_REACT_DESKTOP.md](engineering/GO_REACT_DESKTOP.md)。MES的分工與切換另看 [MES_PRODUCTION_MIGRATION.md](engineering/MES_PRODUCTION_MIGRATION.md)。

## 部署、公開使用與私有管理限制

1. 先讀對應 repo 的 release workflow/runbook，核 current main SHA、artifact/image digest、host release pointer；保存 deployment time、health revision、DB health、rollback pointer。
2. 逐站核 DNS/TLS/公開路由 upstream、匿名 API拒絕、授權登入、只讀資料及交易流程。Caddy route switch 與 app deploy 分開記；route切換前備妥 rollback，切換後若已有 target writes，回退前先凍結兩側並 reconciliation。
3. `main` green、image publish、GitHub Deployment record、私有 loopback health、公網 HTTPS、browser acceptance分別記錄。GitHub無 deployment record只表示該 API無記錄，非證明沒用其他 pipeline；同樣，舊 runbook裡的 host紀錄也不證明今天 live。
4. 公開 Works/D1 demo role selector只提供隔離展示，並非企業登入/RBAC；金流、寄信、物流等除非有即時 adapter證據均標示 simulated/mock。
5. Workspace owner bootstrap、Google OAuth secret/client、正式 API keys均為私有 operator設定，不放 repo、PR、log 或此文件。若該工作仍依使用者要求延後，維持延後；開始後走私有 CLI/credential flow，再實際測登入、撤權、跨帳戶拒絕與 restore授權。
6. 每次更新狀態都列系統、branch/SHA、workflow/run、環境、deployment revision、資料快照/digest、外部端點/時間、回滾證據與尚缺的 UI/身份驗收。沒有實測就寫「未知」。

## 下一輪交接順序

1. **Portfolio infra**：PR #59、#61 已修復 `erp_public_route.py` quoted enum finding 並合併至 main。接續推進外部路由與公開切換驗證。
2. **MES & ERP 領域事件串接 (P2)**：基於 MES PR #21 與 ERP PR #22 已合併的資料模型，依 `MES_ERP_INTEGRATION.md` 定義製造報工完工入庫至 ERP 庫存台帳之 Outbox 事件格式與非同步重試機制。
3. **資料遷移與帳號映射演練 (P2)**：針對既有 demo workspace 及歷史訂單，在隔離 staging 環境進行唯讀備份轉換，核實 source-to-destination 筆數、金額、庫存與身份映射，驗證交易失敗時原資料無損。
4. **私有主機候選部署與健康檢查 (P3)**：各系統 PR 合併後皆已產出最新 Docker 候選映像，於私有環境部署並驗證 `/api/health` 回傳之精確 commit SHA 與匿名請求拒絕。
5. **Windows 客戶端實機驗收 (P4)**：在真實 Windows 設備上安裝 MES/ERP/CRM client-server，測試 SQLCipher 加密金鑰、本地資料路徑與網路斷線復原。
6. **Portfolio identity operator（若工作已獲排期）**：用私有設定完成 owner/Google OIDC/帳戶金鑰；驗真實 provider callback 及 access denial/revocation，不以 synthetic CI 代替。

## 可重現的 handover 查詢（只讀）

在任一工作目錄安裝並登入 GitHub CLI 後：

```powershell
$repos = @('profolio','business-suite-mes','business-suite-erp','business-suite-pos','business-suite-crm','business-suite-dining','business-suite-shop')
foreach ($repo in $repos) {
  Write-Output "--- $repo main ---"
  gh api "repos/Davis1233798/$repo/commits/main" --jq '{sha:.sha, date:.commit.committer.date, subject:.commit.message}'
  gh api "repos/Davis1233798/$repo/actions/runs?branch=main&per_page=1" --jq '.workflow_runs[0] | {id:.id, head_sha:.head_sha, status:.status, conclusion:.conclusion, html_url:.html_url}'
  gh api "repos/Davis1233798/$repo/deployments?per_page=1" --jq 'if length == 0 then "no GitHub deployment record" else .[0] | {sha:.sha, environment:.environment, updated_at:.updated_at} end'
  gh pr list --repo "Davis1233798/$repo" --state open --json number,title,headRefName,updatedAt,url
}
```

檢查指定 PR 的 exact head/status：

```powershell
gh pr view 59 --repo Davis1233798/profolio --json headRefOid,state,statusCheckRollup,url
gh pr view 13 --repo Davis1233798/business-suite-crm --json headRefOid,state,statusCheckRollup,url
gh pr view 19 --repo Davis1233798/business-suite-shop --json headRefOid,state,statusCheckRollup,url
```

這些指令是 GitHub read-only 查詢；主機、OCI、DNS、資料庫和公開 endpoint 必須按相應 runbook 另查，不能從上述結果推論其狀態。執行部署/資料變更命令前先閱讀相應 runbook，確定操作者、備份、維護鎖與 rollback。

## 關聯資料

- [CONSTRUCTION.md](CONSTRUCTION.md)：系統拓樸、repo/path地圖、資料身份邊界。
- [DEVELOP_PLAN.md](DEVELOP_PLAN.md)：推薦工作分期與系統優先序（與本 handoff 同批提供，建議合併後以 repository main 為準）。
- [HARNESS.md](HARNESS.md)：工程邊界、證據層級與驗收流程（與本 handoff 同批提供，建議合併後以 repository main 為準）。
- [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md)：較舊的開發與部署證據快照；不要覆蓋本 handoff 的本日 PR/CI查詢，但也不要把文件快照當成live。
- [ACCEPTANCE.md](ACCEPTANCE.md)：legacy Vinext/D1 implementation的逐項驗收邊界；其中列舉不等於獨立 Go 系統已同等交付。
- [ARCHITECTURE_HANDOFF.md](ARCHITECTURE_HANDOFF.md)：各 repo 的程式與部署邊界。
- [engineering/LOOP.md](engineering/LOOP.md)：循環式開發／遠端驗收工作規範。
