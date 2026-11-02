# 目前開發狀態

此文件記錄目前進行中的系統與功能；每項工作的架構、程式邊界、測試、實作及遠端驗證依 `engineering/LOOP.md` 更新。歷史狀態與原先設計另見 `engineering/GO_REACT_DESKTOP.md` 和 `engineering/WORKSPACE_REFACTOR.md`，不以舊紀錄表示目前版本已通過驗收。

| 系統 | 功能 | 階段 | 證據與限制 |
|---|---|---|---|
| 共用資料移轉／MES、ERP、POS、CRM、餐飲、電商 | 舊版備份檢查、身分對應、隔離暫存與匯入前快照 | 功能已實作；正式演練待完成 | [快照架構與邊界](engineering/WINDOWS_MIGRATION_SNAPSHOT.md)。已有受控離線命令，沒有 HTTP 匯入；舊版 Node 與 Go 資料庫分開，正式切換未完成。 |
| 共用資料移轉／六站 | 正式匯入、維護窗口與備份還原 | 架構與程式邊界設計；測試及實作待完成 | [交付架構與測試計畫](engineering/LEGACY_IMPORT_DELIVERY.md)。跨程序維護保障及還原演練完成前不得開放匯入。 |
| 共用資料移轉／六站 | 離線匯入協調器 | 內部實作完成，等待最新版本遠端驗證 | [協調器設計與 Red 證據](engineering/LEGACY_OFFLINE_IMPORT.md)。已有操作員命令，沒有 HTTP 匯入入口。 |
| 共用資料移轉／六站 | 離線匯入操作入口 | 實作完成，等待遠端 Green | [命令設計、限制及 Red 證據](engineering/LEGACY_IMPORT_COMMAND.md)。尚未對正式資料執行；生產還原演練待完成。 |
| 共用資料移轉／六站 | 從備份建立還原候選檔與內容比對 | 實作後等待遠端 CI | [架構、邊界及測試](engineering/LEGACY_RESTORE_COPY.md)。候選檔需比對來源 schema、版本與逐列內容；尚未完成正式還原演練。 |
| 共用 Go 站台／六站 | 同主機維護窗口協調 | 已實作，等待遠端 Green | [鎖定架構、限制與 Red 證據](engineering/MAINTENANCE_LOCK.md)。不約束未遵循協定的程序；伺服器與維護模式端到端尚待驗證。 |
| 共用／列印 | 批次標籤條碼與重複預覽 | 實作後等待遠端 CI 和瀏覽器驗收 | 不支援的條碼停用列印；實體掃描器驗收尚未完成。 |
| MES／ForgeFlow | 品檢放行、成品批次入庫與工單結案 | 初版與後續處置歷程整合中 | [MES 功能架構與測試計畫](engineering/MES_FINISHED_GOODS.md)。PR `02aa3f5` 的 CI 全部通過；後續處置歷程仍在分支驗證，ERP 庫存同步及實際裝置驗收未完成。 |
| 桌面版／MES、ERP、CRM | Electron 工作區與 Windows 打包 | 遠端回歸中 | 其他系統維持網頁版；先前 Windows 快照失敗已修正，`cac79a0` 的 Windows CI 通過，最新版本仍須驗證。 |
| 共用／部署 | GitHub Actions 與公開站台 | 尚未完成切換 | PR `02aa3f5` 的 CI 已通過，但部署 job 因非預設分支而略過；不以程式碼推送推論部署成功。 |

先前已進行的程式修改不追溯宣稱符合新指定順序；自本次起依架構、邊界、測試、實作的順序迭代。
