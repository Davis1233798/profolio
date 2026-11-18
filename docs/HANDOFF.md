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
| P0 | Portfolio 發版路徑與 POS P07 交接，[PR #59](https://github.com/Davis1233798/profolio/pull/59) | PR head `14bd6b942ecb7aba0824479dfd7515cc3aeb203a`，2026-11-16 更新。`web`、`infrastructure`、`station-delivery`、Windows desktop、k6 checks 成功；OCI deploy 為 skipped。未解決的 review finding 指向 `infra/linux/erp_public_route.py:13-15`：`ERP_PUBLIC_ROUTE="shared"` / 單引號 enum 會被拒絕；`deploy-release.sh` 在 `set -e` 下無條件執行 parser，可能阻擋所有後續 release、public-sites apply 和 MES route cutover。PR 本文只記 POS P07 設計起點，會員關聯實作與驗收仍待辦。 | Portfolio infra 維護者先比照 `infra/linux/mes_public_route.py` 修正可選引號解析與驗證，補 quoted/unquoted enum 測試，跑 PR exact-head checks 並重新 review；確認 route parser 不再阻斷一般 release 後再合併。另由 POS 負責者把 P07 身分／會員資料界線、API、測試、畫面與接受條件列成單獨工作，不把此狀態文件 PR 當成實作完成。 |
| P0 | CRM API ownership，[PR #13](https://github.com/Davis1233798/business-suite-crm/pull/13) | head `d4770b39983a2e894e5a8b2fef16d994dfeb51f4`，2026-11-16 更新。兩次 CRM checks 成功，但兩次 `windows-desktop` 失敗（runs [43891794422](https://github.com/Davis1233798/business-suite-crm/actions/runs/43891794422)、[43891720946](https://github.com/Davis1233798/business-suite-crm/actions/runs/43891720946)）；publish skipped。PR 變更非管理員對商機與關聯報價、活動讀取/列印的 owner 限制；沒有 schema、live DB 或部署修改。 | CRM 維護者從上述 Windows job logs 找根因，修復後重跑最新 PR head 的 Linux/Windows checks；同時確認 CRM PR #13 涵蓋範圍外仍有共用 CRM datasets，檢閱明確記錄的限制，再考慮合併。CI 綠燈不代表既有 Windows 安裝或正式資料遷移完成。 |
| P0 | Shop private OCI candidate，[PR #19](https://github.com/Davis1233798/business-suite-shop/pull/19) | head `408f0476ef6f1702ec69d52a864646b9fe992b1f`，2026-11-16 更新。主 `shop (ubuntu-latest)` 失敗，ARM job cancelled；PostgreSQL transaction verification 成功；image publish 與 candidate index publish skipped（run [43890901487](https://github.com/Davis1233798/business-suite-shop/actions/runs/43890901487)）。PR 明確不佈署 host、不改 public routing、不證明 GHCR package privacy。 | Shop 維護者查 failure job/artifact、修 CI 後重跑兩架構完整 workflow；檢查候選映像 digest、GHCR 可見性、isolated volume/network、first-start 和 rollback 證據。通過後先做私有主機候選部署驗收，再另行核准/安排公開路由；不可把 workflow prep 宣稱成已部署。 |
| P1 | MES production migration/cutover | Runbook 指 MES 操作者負責 source/target reconciliation；Portfolio 操作者負責 Caddy mode 與 route rollback。需先在 maintenance ticket 指定兩人。文件仍列 production snapshot rehearsal、account enrollment、public route switch 為 outstanding；本日未重新查主機/公網。 | MES 操作者盤點獲准 organization IDs、帳戶與 grants，建立實際來源／候選一致備份及 digest，在隔離位置演練匯入和業務核對；Portfolio 操作者核對 root-owned ingress socket、route 和 rollback。凍結寫入前須雙方具名，公開切換前驗登入、revision、只讀資料與回退。詳見 [MES_PRODUCTION_MIGRATION.md](engineering/MES_PRODUCTION_MIGRATION.md) 和 [MES_PUBLIC_ROUTE_CUTOVER.md](engineering/MES_PUBLIC_ROUTE_CUTOVER.md)。 |
| P1 | ERP routing 與既有資料門檻 | ERP `main` 已有私有 production deployment record（SHA `4de38f1366befc2d5fc66123065f35dbce11b4de`，2026-11-13）。不證明現今 host revision、data import 或 public route 已核驗。部署記錄指出公開 ERP route 須等獨立資料與使用者驗證；既有 legacy ERP 資料要先確認所有權和帳戶映射。 | ERP 操作者驗私有 health/revision、帳戶/tenant 與資料持續性；完成 legacy inventory reconciliation 和回滾演練後，依 [ERP_PUBLIC_ROUTING.md](engineering/ERP_PUBLIC_ROUTING.md) 驗 anonymous reject、登入、revision，再由 Portfolio 操作者切換。ERP `main` 最新 CI [run 43431087289](https://github.com/Davis1233798/business-suite-erp/actions/runs/43431087289) 成功；其前一 commit run 43431079289 失敗，不能以舊 failure 取代 current SHA 結果。 |

## 分系統未完成工作與目前交付證據

> 遠端 `main` SHA 與最新 workflow 是 2026-11-18 查詢值。GitHub Deployment 一欄只表示 GitHub API 是否有部署紀錄，不等於其他渠道部署不存在；未知狀態需直接核主機、外部 HTTPS、health/revision、使用者流程。

| 系統 | 當前遠端來源／CI | 部署與驗收缺口 | 接手下一步 |
|---|---|---|---|
| Portfolio / 中央站 | `profolio/main` `db0938094b22c69f86fa270e59aaee3fb934a84c`；最新 main workflow [43683354169](https://github.com/Davis1233798/profolio/actions/runs/43683354169) success；GitHub Deployments 無紀錄。PR #59 見上表。 | DEVELOPMENT_STATUS 的主站 health/revision 證據日期是 2026-11-04，不能當本日 live proof。owner bootstrap、實際 workspace 身分與 Google OAuth callback 尚待私下設定/驗證（OAuth與owner延後是既定邊界）。中央 Go、Workers web、獨立站和各資料庫彼此分離。 | 先修 PR #59 parser finding；之後 read-only 核主站 release pointer、`/api/health` SHA、資料庫 health、anonymous backup/export/restore拒絕，再做 admin account/key/revocation/restore 的真實授權測試。Secrets 不得寫 repo/issue/聊天。 |
| MES / ForgeFlow | `business-suite-mes/main` `ece556d9aed3ab9a4512813029c91218524e51ab`；最新 workflow [43249753022](https://github.com/Davis1233798/business-suite-mes/actions/runs/43249753022) success；GitHub deployment `mes-production` 指向同 SHA，更新 2026-11-12。 | public hostname、當前 rootless/route、真實 production migration rehearsal、account enrollment、完整 browser transaction sequence 本日未知/待核；GitHub deployment 與舊 runbook 不能替代即時 host evidence。MES/ERP 商品/倉庫/成本映射和 outbox 應以當前程式/API驗，不要推定成品已自動同步。 | 指定 MES + Portfolio operators；按 MES runbook 對工單、operations、reports、material moves、quality、finished goods、accounts/grants、report retry mapping 和 outbox archive digest 做來源到候選核對。測一條完整報工→品檢→入庫→ERP映射/過帳流程及冪等重試。 |
| ERP / LedgerWorks | `business-suite-erp/main` `4de38f1366befc2d5fc66123065f35dbce11b4de`；latest workflow [43431087289](https://github.com/Davis1233798/business-suite-erp/actions/runs/43431087289) success；GitHub deployment `erp-production` 指向該 SHA，2026-11-13。 | 關帳、公開 route 與 legacy inventory/account ownership reconciliation 是分開驗收。每日/財務交易需驗 ledger replay 順序、成本、稽核、回滾。當前 host/browser live revision 未確認。 | ERP 操作者檢核採購/分收、銷售出貨/成本、調撥、退貨、應收付、傳票、盤點/關帳；建 recovery backup，再私有核 revision/資料。公開切換前依 routing runbook 檢查授權與 anonymous rejection。 |
| POS / CounterPoint | `business-suite-pos/main` `f8897c5967fbd78834422cf103f668c109fddd08`；latest workflow [43880345013](https://github.com/Davis1233798/business-suite-pos/actions/runs/43880345013) success；GitHub Deployments API 無紀錄。POS 私有 OCI evidence 在 portfolio PR #59 所記 run `43738660955` / SHA `228124e`，host revision 綠燈；此為文件中既有 evidence，非本日重查。 | 公網 DNS/TLS/外部可達性未驗。POS PR #15 已加入有界 partial cash refund；PR #16 補 cash movements/shift variance close（不等於所有退款情境完成），P07 有會員身份架構提案（#17）及 gated consumer identity foundation（#19），但 #19 明確未含 email delivery、checkout 關聯、交易歷史或 public routing，production routes hard-disabled；不可稱會員流程已完成。cashier receipt reprint（#18）已合併；PR #15 明列原班次關閉後退款、非現金/gateway reversals及多品項退款仍未交付。migration policy 不支援 open-shift 匯入：來源未結 shifts 必須停工處理，不能自動關班。 | POS operator 在私有 host 核最新 SHA 是否較舊；跑 shift open/close、barcode、sale、hold/retrieve、refund、receipt reprint、daily report 的瀏覽器驗收。按明確身分映射處理 cashier/locked_by/user refs；open shifts 先在 source resolution。公開 route 需另行審核。 |
| CRM / RelationDesk | `business-suite-crm/main` `a65a0190122dc48234ebe85bdde386ed22a1c0e1`；latest main workflow [43247745112](https://github.com/Davis1233798/business-suite-crm/actions/runs/43247745112) success；GitHub deployment 無紀錄。PR #13 Windows checks pending repair. | 中央 CRM 的聯絡人/同意、活動、報價版本、客服等仍須逐流程比對獨立版；legacy owner identity mapping、CRM migration/recovery、private OCI和 Windows installed client-server 尚無完整當前驗收證據。 | 修 #13 checks；對 lead `assigned_to`、account/activity/opportunity `owner_id` 建立明確 user mapping與有效 back-office grants；驗 atomic lead conversion、stage/quote authorization、跨租戶拒絕、audit/retry。Windows 驗 SQLCipher DB、啟動/更新/復原與登入，不從 CI package 推定使用者電腦狀況。 |
| Dining / TableCraft | `business-suite-dining/main` `96f445ea5300d8a99927f7a549a784d9102ea28b`；latest workflow [43571008851](https://github.com/Davis1233798/business-suite-dining/actions/runs/43571008851) success；GitHub deployment 無紀錄。此前 runbook 記 standalone OCI acceptance PR #55，但本日未連主機。 | route/revision、本日 browser/table/KDS驗收未知；訂位/桌次/出餐/拆帳結算/退款與資料移轉須各自驗證。 | Dining operator 核現在 host/route/revision；測 reservation conflict、open table、multi-item orders、KDS transitions、split settlement/refund、營收對帳及重送/並行。核實 offline workspace import preview/apply/snapshot 在主機的備份與回復。 |
| Shop / MarketLane | `business-suite-shop/main` `2714155d4d5ea06bebee1b58d2aa6c2c79914d5e`；latest main workflow [43610358910](https://github.com/Davis1233798/business-suite-shop/actions/runs/43610358910) success；GitHub deployment 無紀錄。PR #19 candidate CI未綠。 | private OCI candidate未部署；public route、移轉/restore、browser/mobile flow未驗。Payment/shipping為mock；不得表述成真實金流物流。Legacy `user_id`、review/cart/order owners 以及 reservation `session_id`需明確映射；active reservations、pending/failed payment、unfinished returns須先處理。 | 先修 PR #19 checks；之後核 candidate isolation/digest/recovery，部署私有測試。端到端測 catalog/coupon/cart/checkout/payment mock/fulfillment/refund/review、tenant isolation、庫存/訂單總額不變量與重送；公開切換待正式資料核對和回滾演練。 |

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

1. **Portfolio infra**：處理 PR #59 `erp_public_route.py` quoted enum finding，新增測試，exact-head checks/review；修後確認 normal release、public-site apply、MES route path可解析。記錄 P07 只作設計或轉成有可驗收範圍的實作 issue/PR。
2. **CRM CI owner**：讀 PR #13 兩個 Windows job failure logs；修復、重新跑 Windows + CRM checks，追蹤發布是否解除 skip。
3. **Shop CI owner**：讀 PR #19 Linux failure；查 ARM cancellation原因，恢復 ARM job，確保 publish gate在所有平台都綠後才產物發布。
4. **MES data operator + Portfolio route operator**：在 maintenance ticket留具名角色；演練和核對真實備份/帳戶/資料，只有 evidence通過才安排 write freeze、cutover與可回退的公開路由。
5. **ERP/POS/Dining/CRM/Shop operators**：各自核私有 host current revision、schema upgrade/backup/restore、tenant/auth、完整業務流程；再分開排公開 ingress和來源資料 migration。先做仍有legacy ownership不明或活動交易的阻斷清單。
6. **Windows owner**：只針對 MES/ERP/CRM 做真實安裝、啟動、登入、資料路徑/加密、client-local Go connection、更新和恢復演練，保留版本和脫敏證據。
7. **Portfolio identity operator（若工作已獲排期）**：用私有設定完成 owner/Google OIDC/帳戶金鑰；驗真實 provider callback及access denial/revocation，不以synthetic CI代替。

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
