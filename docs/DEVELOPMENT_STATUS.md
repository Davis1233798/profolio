# 目前開發狀態

此文件記錄目前進行中的系統與功能；每項工作的架構、程式邊界、測試、實作及遠端驗證依 `engineering/LOOP.md` 更新。歷史狀態與原先設計另見 `engineering/GO_REACT_DESKTOP.md` 和 `engineering/WORKSPACE_REFACTOR.md`，不以舊紀錄表示目前版本已通過驗收。

| 系統 | 功能 | 階段 | 證據與限制 |
|---|---|---|---|
| 共用資料移轉／MES、ERP、POS、CRM、餐飲、電商 | 舊版備份檢查、身分對應、隔離暫存與匯入前快照 | 開發中；Windows 快照相容性修復 | [本輪架構、邊界與測試](engineering/WINDOWS_MIGRATION_SNAPSHOT.md)。匯入尚未對外開放；舊版 Node 與 Go 資料庫分開，正式切換未完成。 |
| 桌面版／MES、ERP、CRM | Electron 工作區與 Windows 打包 | 遠端回歸中 | 其他系統維持網頁版；Windows 測試有失敗，見本輪文件。 |
| 共用／部署 | GitHub Actions 與公開站台 | 驗證中 | PR 與分支結果須依各次 Actions 執行記錄確認；不以程式碼推送推論部署成功。 |

先前已進行的程式修改不追溯宣稱符合新指定順序；自本次起依架構、邊界、測試、實作的順序迭代。
