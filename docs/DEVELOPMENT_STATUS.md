# 目前開發狀態

此文件以 2026-11-03 GitHub 最新狀態為基準，記錄程式合併、CI、正式部署及端到端驗收的不同證據。合併或 CI 通過不代表已部署、資料已遷移或 UI/主機驗收完成。各項工作仍依 `engineering/LOOP.md` 更新。

## 最新主站與分站證據

| 系統 | 最新已合併變更 | 遠端證據 | 部署／驗收狀態與剩餘工作 |
|---|---|---|---|
| 主站／MES 路由 | [profolio PR #17](https://github.com/Davis1233798/profolio/pull/17) 控制 `mes.<BASE_DOMAIN>` 切換，預設仍走 shared；隔離路由固定外部網路與服務名稱。 | PR 已合併至本次 base；main workflow [run 522](https://github.com/Davis1233798/profolio/actions/runs/41636478300) 成功。 | GitHub Deployments API 未回傳任何部署紀錄，GitHub Pages API 亦未配置。這是路由 IaC/測試合併，不是主站或 MES 已切換的證據。公開 DNS、Caddy/host、服務與資料卷均未由 PR 修改；正式路由切換、TLS/健康檢查、授權/拒絕路由驗收仍待完成。 |
| MES／ForgeFlow | 最新單站 PR：[ #7 權限強化](https://github.com/Davis1233798/business-suite-mes/pull/7)；另有 [#6 migration 合約](https://github.com/Davis1233798/business-suite-mes/pull/6)、[#5 Windows 身分/資料隔離](https://github.com/Davis1233798/business-suite-mes/pull/5)、[#4 隔離部署](https://github.com/Davis1233798/business-suite-mes/pull/4)。 | PR #7 合併；該站最新 main workflow 當時仍 `in_progress`（[run](https://github.com/Davis1233798/business-suite-mes/actions/runs/41660278024)）；PR #7 的前次 main CI 曾成功。 | 該站 Deployments API 無記錄。尚需完成遠端 CI、選定正式 host、部署憑證/公開路由、部署與回滾、公開 TLS/路由/授權驗收、正式資料 migration 與備份還原演練、瀏覽器與 Windows 裝置驗收。rootless 部署草稿假設專用 host，是待決架構選擇，並非使用者已指定的 host。 |
| ERP | 最新已合併 PR：[ #3 Windows 身分與資料隔離](https://github.com/Davis1233798/business-suite-erp/pull/3)。 | 最新 ERP main workflow [run](https://github.com/Davis1233798/business-suite-erp/actions/runs/41632486732) 成功。 | Deployments API 無記錄。正式 host、獨立部署與路由、資料 migration/還原、正式資料演練、UI/瀏覽器及 Windows 驗收均待辦。 |
| CRM | 最新已合併 PR：[ #2 Windows 身分與資料隔離](https://github.com/Davis1233798/business-suite-crm/pull/2)。 | 最新 CRM main workflow [run](https://github.com/Davis1233798/business-suite-crm/actions/runs/41632623259) 成功。 | Deployments API 無記錄。正式 host、獨立部署與路由、資料 migration/還原、正式資料演練、UI/瀏覽器及 Windows 驗收均待辦。 |
| Shop／MarketLane | 最新已合併 PR：[ #8 Go 店面接到結帳](https://github.com/Davis1233798/business-suite-shop/pull/8)；此前 #7 優惠券、#6 退貨退款、#5 出貨操作亦已合併。 | Shop main 最新 workflow [run](https://github.com/Davis1233798/business-suite-shop/actions/runs/41629912855) 成功。 | Deployments API 無記錄。程式/CI 不代表正式店面已部署；正式 host、路由、金流/物流串接、資料 migration、瀏覽器/行動裝置端到端驗收待辦。 |

主站 GitHub Actions 成功只證明該 workflow 成功。GitHub Deployments API 回傳 0 筆，故本次無法以 GitHub 證據確認目前正式主站部署版本；不可沿用歷史健康檢查或 commit 訊息推論最新正式版本。已知 OCI 可用是部署選項，不等於正式 host 已選定或部署已完成。

## 完整剩餘代辦

### 部署與主機

- 先確認各服務的正式 host/環境與所有權，再定案是否採用 MES rootless 草稿所假設的專用 host；目前不得將該假設寫成既定需求。
- 完成主站 IaC 所需的正式環境變數、秘密、網路/路由配置及安全審查；確認是否採 OCI 或其他已核准的現有環境。
- 取得 host 端部署憑證與執行權限，部署 MES、ERP、CRM、Shop 分站；配置 DNS、Caddy/TLS、健康探測及回滾流程。
- 逐站核對公開 HTTPS/TLS、路由目標、未授權請求拒絕、管理員授權與版本識別；保留外部觀測證據。
- 只有在 host 與路由實際驗收成功後，才更新「正式部署完成」狀態。

### 資料移轉與復原

- 完成舊版資料盤點、備份格式/版本檢查、身分與租戶映射及隔離暫存核對。
- 遠端 CI 確認離線匯入協調器、操作命令、還原候選檔內容比對、維護鎖及跨系統 ERP/CRM 關聯演練。
- 確認正式切換範圍、維護窗口及回復條件；執行匯入前快照、正式/核准資料演練、逐列或業務不變量比對、回滾及備份還原演練。
- 保留不同系統資料庫與租戶邊界；不得因部署共享主機而掛載或修改另一站 SQLite 卷。
- 完成前不得宣稱正式 migration、host 切換或還原演練通過。

### 功能、介面與實機驗收

- MES：部署後驗收報工、品檢放行、成品批次入庫、工單結案及 ERP 庫存同步；確認成本/商品/倉庫映射管理流程，完成實際瀏覽器與裝置操作驗收。
- ERP／CRM：確認各自最新合併後功能與 Windows 隔離行為；補齊正式資料、瀏覽器 UI、Windows 打包/執行驗收。
- Shop：驗收 Go 店面到 checkout、租戶隔離優惠券、出貨、退貨退款及訂單狀態；接妥正式金流/物流 callback 並完成瀏覽器及行動端端到端驗收。
- 共用列印：等待遠端 CI，完成支援/不支援條碼行為、重複預覽及實體掃描器驗收。
- 共用 Go 站台維護鎖、release revision、公開部署版本識別：完成遠端 Green 與 server/maintenance-mode 端到端驗證。
- 併發展示：完成可操作展示介面與停止狀態驗收；隔離 API 測試不等於 UI 展示驗收。

### 桌面與發佈

- 核對 MES/ERP/CRM 最新提交各自 Windows CI，不用舊提交的成功結果替代最新版本狀態；完成打包安裝、啟動、資料位置/身分隔離及更新流程實機驗收。
- 每項正式發布記錄 repo、commit、環境、部署時間、健康檢查及回滾證據；若只看到合併/CI，狀態維持「未確認部署」。

## 已知狀態判讀

- 本次讀取的分站 GitHub Deployments API 均無部署紀錄；主站亦為 0 筆。這不證明其他管道絕無部署，但目前沒有可用的 GitHub 部署證據可確認。
- MES、ERP、CRM、Shop 的 PR 合併與成功 workflow 僅代表原始碼/CI 狀態，不能代替 host、資料遷移或 UI/裝置驗收。
- 本次只編修此狀態文件；沒有本機測試、沒有操作 dirty 原樹，也沒有變更服務、DNS、host 或資料。
