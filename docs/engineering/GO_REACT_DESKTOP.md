# Go + React + Electron

2026-10-31 使用者指定：後端 Go，前端 Angular 或 React，Electron 桌面版，支援平板／手機／智慧裝置。採 React 保留現有六站設計；不重做為 Angular。

## 目標拓樸

瀏覽器／平板／手機 React 與 Electron 同用 HTTPS Go API。Go 負責登入、各站 RBAC、業務交易、列印資料、稽核與資料隔離。Electron 使用 sandbox、contextIsolation、關閉 nodeIntegration，遠端內容不可取得任意系統權限。MQTT collector 與工業時序服務繼續獨立部署。

裝置範圍：可使用現代瀏覽器的觸控／工業平板與智慧螢幕共用響應式 Web；無瀏覽器的 AIoT 感測裝置透過既有 MQTT 服務接入。Electron 以桌面 OS 為目標，不宣稱可安裝於 iOS／Android。

## 桌面版系統範圍

桌面程式目前僅提供 MES、ERP、CRM 的入口與畫面。POS、餐飲和電商繼續使用網頁版；這項調整不改變 Web 的站台功能或資料。

## 遷移界線

公開 release 18 暫維持既有服務。新增 `backend/` Go、`web/` 純 React、`desktop/` Electron。必須完成原有業務 API 的逐項移植與回歸後才可切換公開站台；Go 不可只是轉送 TypeScript API。

新登入以 Go 為權威；未使用改架構前的 TypeScript 登入草稿。登入／權限／列印需求繼續以 `FULL_STATIONS.md` 驗收。

狀態：遷移實作中；不得把新目錄、可編譯或桌面容器等同完整移植。

## 已驗證的新架構基礎

- Go 1.26 + SQLite（無 CGO），純 React / Vite；新 API 不轉送至舊 TypeScript。尚未移植的舊 API 明確回 501，沒有模擬成功。
- 六站各自站內導覽，登入頁四身分測試帳號，伺服器工作階段、各站 RBAC、前後台欄位隔離、管理員新增帳號與啟停授權、稽核、登出。
- 四項 Go 整合測試涵蓋資料表契約、身分偽造、跨組織授權、即時撤權、前台財務隔離、列印文件跨租戶隔離、密碼與 Origin 驗證。
- 52 張表的虛構測試資料由既有 `seedOrganization` 匯出；Go 自行建立測試企業，不會連線舊 TypeScript 服務。SQLite 遷移副本以 `scripts/verify-go-migrations.mjs` 檢查一致。
- MES 批號 Code128 標籤以真實目前企業資料產生，瀏覽器預覽通過；手機／平板實測無頁面級水平溢出（使用者 Chrome 縮放造成有效 CSS viewport 分別 240／512 px）。尚未實測實體標籤機。
- Windows Electron x64 已打包並實際開啟，隨附 Go exe 與 React assets；本機後端使用隨機 loopback port，資料保存在應用程式 userData，不寫入發布目錄。sandbox / contextIsolation 開啟、Node 關閉、拒絕跨來源導航與裝置權限，依據 [Electron 官方安全文件](https://www.electronjs.org/docs/latest/tutorial/security)。

## 執行

- `npm run go:test`、`node scripts/verify-go-migrations.mjs`
- `npm run desktop:prepare`：建置 React 與目前 OS 的 Go binary。
- `npm run desktop:dev`：使用本機 Go 與獨立 userData 開啟桌面版。
- GitHub Actions `desktop-windows` 在 push 與 pull request 建置 Windows 未簽章目錄，執行桌面啟動與站台入口檢查後上傳 workflow artifact；預設分支部署須等待此工作通過。此自動檢查不等同完整視覺與業務流程驗收。
- Windows：`npm run desktop:package` 產生 `outputs/desktop/win-unpacked/Business Suite.exe`（未簽章，需攜帶整個目錄）。
- 本機 Go Web 預覽：`http://127.0.0.1:8095/mes/login`，目前與既有 SSH 8791 預覽分開。

## 尚未完成

- 原有 MES／ERP／POS／CRM／餐飲／電商所有交易寫入與財務／庫存／報工狀態規則的 Go 移植、TDD 回歸。
- 原有 SAP 密集作業工作台與全部表單接入純 React；目前新站台先提供查詢、身分與列印流程，不能當成完整業務版。
- Go 對 Redis／RabbitMQ／MQTT／Timescale／分片 PostgreSQL 既有整合與排程的替換驗收。
- Linux ARM64 Go 容器、IaC 控制圖更新與正式八網域切換驗證；目前公開站台仍是 release 18。
- 實體列印、行動實機／智慧裝置、桌面雲端同步與 macOS／Linux 打包尚未驗證。
