# 目前開發狀態

此文件以 2026-11-03 GitHub 最新狀態為基準，記錄程式合併、CI、正式部署及端到端驗收的不同證據。Web 版正式部署目標為 OCI，桌面 client-server 使用本地 Windows；合併或 CI 通過不代表 OCI 隔離服務已配置、資料已遷移或 UI/主機驗收完成。各項工作仍依 `engineering/LOOP.md` 更新。

## 最新主站與分站證據

| 系統 | 最新已合併變更 | 遠端證據 | 部署／驗收狀態與剩餘工作 |
|---|---|---|---|
| 主站／MES 路由 | [profolio PR #17](https://github.com/Davis1233798/profolio/pull/17) 控制 `mes.<BASE_DOMAIN>` 切換，預設仍走 shared；隔離路由固定外部網路與服務名稱。 | PR 已合併至本次 base；main workflow [run 522](https://github.com/Davis1233798/profolio/actions/runs/41636478300) 成功。 | GitHub Deployments API 未回傳任何部署紀錄，GitHub Pages API 亦未配置。這是路由 IaC/測試合併，不是主站或 MES 已切換的證據。公開 DNS、OCI Caddy/隔離服務與資料卷均未由 PR 修改；正式路由切換、TLS/健康檢查、授權/拒絕路由驗收仍待完成。 |
| MES／ForgeFlow | 最新單站 PR：[ #7 權限強化](https://github.com/Davis1233798/business-suite-mes/pull/7)；另有 [#6 migration 合約](https://github.com/Davis1233798/business-suite-mes/pull/6)、[#5 Windows 身分/資料隔離](https://github.com/Davis1233798/business-suite-mes/pull/5)、[#4 隔離部署](https://github.com/Davis1233798/business-suite-mes/pull/4)。 | PR #7 合併；該站最新 main workflow 當時仍 `in_progress`（[run](https://github.com/Davis1233798/business-suite-mes/actions/runs/41660278024)）；PR #7 的前次 main CI 曾成功。 | 該站 Deployments API 無記錄。Web 服務方向已定為 OCI；尚需配置正式 OCI 隔離服務、部署憑證/公開路由、部署與回滾、公開 TLS/路由/授權驗收、正式資料 migration 與備份還原演練、瀏覽器驗收。rootless 部署草稿的專用 host 假設仍須依實際 OCI 拓撲落實。桌面 client-server 方向為本地 Windows，實際安裝及連線驗收仍待完成。 |
| ERP | 最新已合併 PR：[ #3 Windows 身分與資料隔離](https://github.com/Davis1233798/business-suite-erp/pull/3)。 | 最新 ERP main workflow [run](https://github.com/Davis1233798/business-suite-erp/actions/runs/41632486732) 成功。 | Deployments API 無記錄。OCI 正式隔離部署與路由、資料 migration/還原、正式資料演練、UI/瀏覽器驗收，以及本地 Windows client-server 安裝與連線驗收均待辦。 |
| CRM | 最新已合併 PR：[ #2 Windows 身分與資料隔離](https://github.com/Davis1233798/business-suite-crm/pull/2)。 | 最新 CRM main workflow [run](https://github.com/Davis1233798/business-suite-crm/actions/runs/41632623259) 成功。 | Deployments API 無記錄。OCI 正式隔離部署與路由、資料 migration/還原、正式資料演練、UI/瀏覽器驗收，以及本地 Windows client-server 安裝與連線驗收均待辦。 |
| Shop／MarketLane | 最新已合併 PR：[ #8 Go 店面接到結帳](https://github.com/Davis1233798/business-suite-shop/pull/8)；此前 #7 優惠券、#6 退貨退款、#5 出貨操作亦已合併。 | Shop main 最新 workflow [run](https://github.com/Davis1233798/business-suite-shop/actions/runs/41629912855) 成功。 | Deployments API 無記錄。程式/CI 不代表正式店面已部署；OCI 正式部署與路由、金流/物流串接、資料 migration、瀏覽器/行動裝置端到端驗收待辦。 |

主站 GitHub Actions 成功只證明該 workflow 成功。GitHub Deployments API 回傳 0 筆，故本次無法以 GitHub 證據確認目前正式主站部署版本；不可沿用歷史健康檢查或 commit 訊息推論最新正式版本。Web 版部署方向已定為 OCI，但 OCI 隔離服務、公開路由、正式部署及版本驗證尚未完成；桌面 client-server 方向已定為本地 Windows，實機安裝與連線驗收尚未完成。

## 完整剩餘代辦

### 部署與主機

- Web 版正式部署目標已定為 OCI；確認/配置 OCI 隔離服務拓撲、正式環境變數與秘密、網路/路由及安全設定。MES rootless 草稿的專用 host 假設需依 OCI 拓撲落實，不應表述成未決產品方向。
- 完成 OCI 部署憑證與執行權限，部署 MES、ERP、CRM、Shop 分站；配置 DNS、Caddy/TLS、健康探測及回滾流程。OCI 方向已定不代表隔離服務或正式路由已配置。
- 逐站核對公開 HTTPS/TLS、路由目標、未授權請求拒絕、管理員授權與版本識別；保留外部觀測證據。
- 桌面 client-server 使用本地 Windows；配置其連線至正式 Web/API 服務的端點與安全設定，完成 Windows 安裝、啟動、登入、連線及更新實機驗收。
- 只有在 OCI host、路由與本地 Windows client-server 實際驗收成功後，才更新相應完成狀態。

### 資料移轉與復原

- 完成舊版資料盤點、備份格式/版本檢查、身分與租戶映射及隔離暫存核對。
- 遠端 CI 確認離線匯入協調器、操作命令、還原候選檔內容比對、維護鎖及跨系統 ERP/CRM 關聯演練。
- 確認正式切換範圍、維護窗口及回復條件；執行匯入前快照、正式/核准資料演練、逐列或業務不變量比對、回滾及備份還原演練。此項跨 OCI Web 部署及本地 Windows client-server 均未完成。
- 保留不同系統資料庫與租戶邊界；不得因部署共享主機而掛載或修改另一站 SQLite 卷。
- 完成前不得宣稱正式 migration、OCI host 切換或還原演練通過。

### 功能、介面與實機驗收

- MES：OCI 部署後驗收報工、品檢放行、成品批次入庫、工單結案及 ERP 庫存同步；確認成本/商品/倉庫映射管理流程，完成實際瀏覽器操作驗收。本地 Windows client-server 安裝/連線與裝置操作驗收仍待完成。
- ERP／CRM：確認各自最新合併後功能與 Windows 隔離行為；補齊正式 OCI 資料服務與路由、資料 migration、瀏覽器 UI；本地 Windows client-server 打包/執行/連線驗收。
- Shop：驗收 Go 店面到 checkout、租戶隔離優惠券、出貨、退貨退款及訂單狀態；接妥正式金流/物流 callback 並完成瀏覽器及行動端端到端驗收。
- 共用列印：等待遠端 CI，完成支援/不支援條碼行為、重複預覽及實體掃描器驗收。
- 共用 Go 站台維護鎖、release revision、公開部署版本識別：完成遠端 Green 與 server/maintenance-mode 端到端驗證。
- 併發展示：完成可操作展示介面與停止狀態驗收；隔離 API 測試不等於 UI 展示驗收。

### 桌面與發佈

- 核對 MES/ERP/CRM 最新提交各自 Windows CI，不用舊提交的成功結果替代最新版本狀態；完成打包安裝、啟動、資料位置/身分隔離及更新流程實機驗收。
- 每項正式發布記錄 repo、commit、環境、部署時間、健康檢查及回滾證據；若只看到合併/CI，狀態維持「未確認部署」。

## 已知狀態判讀

- 本次讀取的分站 GitHub Deployments API 均無部署紀錄；主站亦為 0 筆。這不證明其他管道絕無部署，但目前沒有可用的 GitHub 部署證據可確認。
- MES、ERP、CRM、Shop 的 PR 合併與成功 workflow 僅代表原始碼/CI 狀態，不能代替 OCI host、資料遷移或 UI/裝置驗收。
- 本次只編修此狀態文件；沒有本機測試、沒有操作 dirty 原樹，也沒有變更服務、DNS、OCI host 或資料。
