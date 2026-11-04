# 目前開發狀態

此文件以 2026-11-04 已查得的 GitHub 與 OCI 證據為基準，記錄程式合併、CI、正式部署及端到端驗收的不同證據。Web 版在既有 OCI 主機運行；MES、ERP、CRM 桌面 client-server 使用本地 Windows。合併或 CI 通過不代表所有服務已更新、資料已遷移或 UI/主機驗收完成。各項工作仍依 `engineering/LOOP.md` 更新。

## 目前開發

- profolio：[PR #20](https://github.com/Davis1233798/profolio/pull/20) 加入 Three.js 點擊／導頁粒子特效與英文／繁中切換。架構與邊界、測試規格先於實作提交；遠端 Chromium 驗收與審核中，尚未合併或部署。
- OCI 入口：[PR #19](https://github.com/Davis1233798/profolio/pull/19) 提供中央 Caddy 至 rootless MES 的 Unix socket 代理；遠端 CI 已通過，尚待最終審核、主機配置及正式切換。

## 最新主站與分站證據

| 系統 | 最新已合併變更 | 遠端證據 | 部署／驗收狀態與剩餘工作 |
|---|---|---|---|
| 主站／Web 部署 | [profolio PR #17](https://github.com/Davis1233798/profolio/pull/17) 控制 `mes.<BASE_DOMAIN>` 路由模式。 | 主機唯讀檢查顯示 `/srv/business-suite/current` 指向 release `48039da886a2f5317430cb01d831f1f847af8435-20261103124642`；外部 `GET https://blockchen.duckdns.org/api/health` 回 `success=true`、資料庫 `connected`。 | GitHub Deployments API 無紀錄不會抹除 OCI 主機直接證據。此證據確認主站 release pointer 與 health；各站版本、資料 migration/還原及逐站瀏覽器驗收仍分別核對。 |
| MES／ForgeFlow | [#8 成品入庫](https://github.com/Davis1233798/business-suite-mes/pull/8)、[#9 既有 OCI 共存](https://github.com/Davis1233798/business-suite-mes/pull/9)、[#10 執行檔版本識別](https://github.com/Davis1233798/business-suite-mes/pull/10) 均已合併；最新 main `318ccebe5f2ef2b3de27c8e0fb00d1365cd71a10`。 | 各 PR 的 Linux／Windows 檢查通過；合併後發版另行追蹤，不等同已部署。 | Web 版使用既有 OCI。獨立 rootless 執行環境、公開路由、正式資料 migration/備份還原及瀏覽器驗收待完成。桌面 client-server 使用本地 Windows，安裝、啟動、登入、資料隔離與連線驗收待完成。 |
| ERP | 最新已合併 PR：[ #3 Windows 身分與資料隔離](https://github.com/Davis1233798/business-suite-erp/pull/3)。 | PR 與 workflow 狀態只作為程式證據；正式主機及用戶端仍需獨立驗收。 | Web 版使用既有 OCI；桌面 client-server 使用本地 Windows。OCI 站台路由/版本、資料 migration/還原、正式資料演練、UI/瀏覽器驗收，以及 Windows 安裝與連線驗收待完成。 |
| CRM | 最新已合併 PR：[ #2 Windows 身分與資料隔離](https://github.com/Davis1233798/business-suite-crm/pull/2)。 | PR 與 workflow 狀態只作為程式證據；正式主機及用戶端仍需獨立驗收。 | Web 版使用既有 OCI；桌面 client-server 使用本地 Windows。OCI 站台路由/版本、資料 migration/還原、正式資料演練、UI/瀏覽器驗收，以及 Windows 安裝與連線驗收待完成。 |
| Shop／MarketLane | 最新已合併 PR：[ #8 Go 店面接到結帳](https://github.com/Davis1233798/business-suite-shop/pull/8)；此前 #7 優惠券、#6 退貨退款、#5 出貨操作亦已合併。 | PR 與 workflow 只證明程式/CI 狀態。 | Web 版使用既有 OCI。正式發布/路由、資料 migration、瀏覽器與行動裝置端到端驗收待辦；付款與出貨目前依功能設計使用模擬流程，未記為正式第三方串接要求。 |

主站直接 OCI 證據顯示 current release SHA 為 `48039da886a2f5317430cb01d831f1f847af8435`，外部主站 health 回報資料庫已連線。此主站證據不替代 MES、ERP、POS、CRM、餐飲及 Shop 六個 Web 站逐站版本/路由檢查；也不表示任何資料 migration 或桌面驗收已完成。桌面 client-server 使用本地 Windows，MES、ERP、CRM 的安裝與連線仍待實機驗收。

## 完整剩餘代辦

### 部署與主機

- Web 版在既有 OCI 主機運行；核對六個 Web 站（MES、ERP、POS、CRM、餐飲、Shop）的版本與路由，完成必要更新，配置部署憑證/權限、DNS、Caddy/TLS、健康探測及回滾驗收。MES rootless 部署文件允許與主站共用 OCI，前提是帳號、daemon、服務及資料隔離檢查通過。
- 逐站核對公開 HTTPS/TLS、路由目標、未授權請求拒絕、管理員授權與版本識別；保留外部觀測證據。
- MES、ERP、CRM 桌面 client-server 使用本地 Windows server；完成各站 Windows 安裝、啟動、登入、client-to-local-server 連線、資料隔離及更新實機驗收。
- 只有在 OCI host、路由與本地 Windows client-server 實際驗收成功後，才更新相應完成狀態。

### 資料移轉與復原

- 完成舊版資料盤點、備份格式/版本檢查、身分與租戶映射及隔離暫存核對。
- 遠端 CI 確認離線匯入協調器、操作命令、還原候選檔內容比對、維護鎖及跨系統 ERP/CRM 關聯演練。
- 確認正式切換範圍、維護窗口及回復條件；執行匯入前快照、正式/核准資料演練、逐列或業務不變量比對、回滾及備份還原演練。此項跨 OCI Web 部署及本地 Windows client-server 均未完成。
- 保留不同系統資料庫與租戶邊界；不得因部署共享主機而掛載或修改另一站 SQLite 卷。
- 完成前不得宣稱正式 migration、OCI host 切換或還原演練通過。

### 功能、介面與實機驗收

- MES：OCI 部署後驗收報工、品檢放行、成品批次入庫、工單結案及 ERP 庫存同步；確認成本/商品/倉庫映射管理流程，完成實際瀏覽器操作驗收。本地 Windows client-server 安裝/連線與裝置操作驗收仍待完成。
- ERP／CRM：確認各自最新合併後功能與 Windows 隔離行為；補齊 OCI Web 站路由/版本核對、資料 migration、瀏覽器 UI；本地 Windows client-server 打包/執行/連線驗收。
- POS／餐飲：核對 OCI Web 站版本/路由並完成收銀、桌位/KDS 流程的瀏覽器驗收。
- Shop：驗收 Go 店面到 checkout、租戶隔離優惠券、模擬付款/出貨、退貨退款及訂單狀態；完成瀏覽器及行動端端到端驗收。
- 共用列印：等待遠端 CI，完成支援/不支援條碼行為、重複預覽及實體掃描器驗收。
- 共用 Go 站台維護鎖、release revision、公開部署版本識別：完成遠端 Green 與 server/maintenance-mode 端到端驗證。
- 併發展示：完成可操作展示介面與停止狀態驗收；隔離 API 測試不等於 UI 展示驗收。

### 桌面與發佈

- 核對 MES/ERP/CRM 最新提交各自 Windows CI，不用舊提交的成功結果替代最新版本狀態；完成打包安裝、啟動、資料位置/身分隔離及更新流程實機驗收。
- 每項正式發布記錄 repo、commit、環境、部署時間、健康檢查及回滾證據；若只看到合併/CI，狀態維持「未確認部署」。

## 已知狀態判讀

- 本次讀取的分站 GitHub Deployments API 均無部署紀錄；主站亦為 0 筆。這不證明其他管道絕無部署，但目前沒有可用的 GitHub 部署證據可確認。
- MES、ERP、CRM、Shop 的 PR 合併與 workflow 僅代表原始碼/CI 狀態，不能代替六站 OCI Web 版本/路由、資料遷移或 Windows client-server 驗收。
- 本次只編修此狀態文件；沒有本機測試、沒有操作 dirty 原樹，也沒有變更服務、DNS、OCI host 或資料。
