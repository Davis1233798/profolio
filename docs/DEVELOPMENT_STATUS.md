# 目前開發狀態

此文件記錄目前進行中的系統與功能；每項工作的架構、程式邊界、測試、實作及遠端驗證依 `engineering/LOOP.md` 更新。歷史狀態與原先設計另見 `engineering/GO_REACT_DESKTOP.md` 和 `engineering/WORKSPACE_REFACTOR.md`，不以舊紀錄表示目前版本已通過驗收。

| 系統 | 功能 | 階段 | 證據與限制 |
|---|---|---|---|
| 共用資料移轉／MES、ERP、POS、CRM、餐飲、電商 | 舊版備份檢查、身分對應、隔離暫存與匯入前快照 | 開發中；Windows 快照相容性修復 | [本輪架構、邊界與測試](engineering/WINDOWS_MIGRATION_SNAPSHOT.md)。匯入尚未對外開放；舊版 Node 與 Go 資料庫分開，正式切換未完成。 |
| 共用資料移轉／六站 | 正式匯入、維護窗口與備份還原 | 架構與程式邊界設計；測試及實作待完成 | [交付架構與測試計畫](engineering/LEGACY_IMPORT_DELIVERY.md)。跨程序維護保障及還原演練完成前不得開放匯入。 |
| 共用資料移轉／六站 | 離線匯入協調器 | 內部實作完成，等待遠端 Green | [協調器設計與 Red 證據](engineering/LEGACY_OFFLINE_IMPORT.md)。目前不提供命令列或 HTTP 入口。 |
| 共用資料移轉／六站 | 離線匯入操作入口 | 實作完成，等待遠端 Green | [命令設計、限制及 Red 證據](engineering/LEGACY_IMPORT_COMMAND.md)。尚未對正式資料執行；生產還原演練待完成。 |
| 共用資料移轉／六站 | 從備份建立還原候選檔 | 實作後等待遠端 Green | [架構、邊界及 Red 證據](engineering/LEGACY_RESTORE_COPY.md)。不替換正在運行的資料庫，尚未完成正式還原演練。 |
| 共用 Go 站台／六站 | 同主機維護窗口協調 | 已實作，等待遠端 Green | [鎖定架構、限制與 Red 證據](engineering/MAINTENANCE_LOCK.md)。不約束未遵循協定的程序；伺服器與維護模式端到端尚待驗證。 |
| 桌面版／MES、ERP、CRM | Electron 工作區與 Windows 打包 | 遠端回歸中 | 其他系統維持網頁版；Windows 測試有失敗，見本輪文件。 |
| 共用／部署 | GitHub Actions 與公開站台 | 驗證中 | PR 與分支結果須依各次 Actions 執行記錄確認；不以程式碼推送推論部署成功。 |

先前已進行的程式修改不追溯宣稱符合新指定順序；自本次起依架構、邊界、測試、實作的順序迭代。
