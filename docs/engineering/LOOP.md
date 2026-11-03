# TDD + Loop Engineering

每個行為變更均以一輪可驗證的循環交付。

使用者指定的必要順序：**架構文件 → 程式邊界 → 程式測試 → 撰寫程式碼**。開始每項功能前，先在 `docs/DEVELOPMENT_STATUS.md` 註明系統、功能、階段及對應文件；接著記錄架構與資料流、輸入輸出／權限／資料與失敗邊界，再先撰寫行為測試，最後實作。以獨立提交或清楚的紀錄保留順序。每次迭代更新狀態與驗證證據；未執行或未通過不得標成通過。使用者要求僅遠端測試時，Red 與 Green 在隔離的 GitHub Actions 執行並記錄 run URL；不以本地測試代替。

1. 定義輸入、輸出、不變量與驗收條件；先列明服務是否實際可用。
2. Red：新增有意義的行為測試，執行並記錄預期失敗原因。
3. Green：實作能通過測試的最小修改。
4. Refactor：改善結構，保持測試通過；不得修改預期值來掩蓋錯誤。
5. Verify：`npm run engineering:check`；基礎設施另跑 `python infra/tests/smoke.py`。
6. Observe：檢查服務健康、消息去重、死信與租戶隔離；壓測另記 p95、錯誤率、吞吐及環境。
7. Review：記錄結果、剩餘風險及下一輪假設；達到驗收條件才結束。

首次政策測試：缺少 `runtime.policy` 時 Red；實作後四項測試 Green。
後續交付必須新增自己的 Red / Green 證據；這段紀錄不能代替後續測試。

控制台這一輪：先新增 `test_control.py`，確認缺少 `control.plane` 時 Red；再實作單次計畫、共享服務影響範圍、依賴啟動順序、過期／漂移與失敗稽核，五項行為測試 Green。Web proxy 另驗證展示 cookie 不會成為控制身分。

MES 同步這一輪：先新增 `mes-projection.test.ts`，缺少 `lib/mes-projection` 時 Red；再驗證既有工單一次性回填、交易回滾時不留下事件、刪除／重建同 ID 的版本不倒退及租戶隔離。分片服務另驗證舊版本不覆寫新版本、刪除標記不被舊事件復活；整站測試須使用實際報工及重置流程等待自動同步。

瀏覽器回歸這一輪：點擊 `next/link` 重現導覽失效；定位為動態 namespace 與瀏覽器入口合併後遺失函式。以 `verify-navigation-build.mjs` 建立失敗 gate，再調整 client chunk 邊界與匯出設定，gate Green，最後以真實瀏覽器點擊驗證頁面切換及 MES 資料更新。HTTP/API 綠燈不能代替這項瀏覽器證據。

## CI

AIoT 模型這一輪：`test_intelligence.py` 因缺少模組先 Red；實作有界歷史窗的 Isolation Forest 後，暖機、固定訊號、可重現性及 held-out 合成故障評估 Green。Linux 實際 MQTT 發送驗證模型訓練、分數／版本持久化與延遲封包不洩漏未來資料，之後再驗證主站控制 collector 重啟。完整證據與限制見 `AIOT_MODEL.md`。

`engineering.yml` 分別驗證 Web 與服務層。容器整合測試使用隔離 Compose project，結束後停止該 CI project。正式發布前仍須檢查實際環境，CI 不代表已完成壓測或雲端部署。

分站執行這一輪：先新增路由測試重現缺少模組的 Red，再實作固定 upstream、獨立程序與序列遷移。35 項應用、15 項 Python 與完整工程檢查 Green。Linux 逐站停啟六個 Web，確認失效只限當站、其他站可用、資料 ID 保留；見 `STATION_RUNTIMES.md`。

MES SAP 介面這一輪：依用戶最新要求替換 Linear 選型，將大面積 KPI 卡改為真實累計摘要與主從工作區；桌面實測發現工作中心落在首屏下方，再移入左側空間。三尺寸、篩選空態、選取、未開工禁止報工及唯讀 403 實測；型別、正式建置與 Linux 既有交易流程通過。此輪未新增僅鏡像樣式的單元測試。

電商併發這一輪：冷 cache 50 請求載入 50 次為 Red，加入隔離的 pending fill 合併後 Green；匿名健康 probe 產生 cookie／租戶為第二個 Red，排除 probe 後獨立資料庫維持零租戶。37 項應用與15項 Python、型別與建置通過；Linux 有限併發與自動隊列派送通過，具體門檻、數字及限制見 `COMMERCE_CONCURRENCY.md`。初次負載工具漏算既有種子訂單而失敗，已改為量測基數後檢查增量，未把測試工具錯誤當作業務競態缺陷。

付款狀態這一輪：交錯20個成功／失敗通知，paid降為failed重現Red；以交易內單向paid保護與提交後讀值修正，Green。38項應用、15項Python、型別與建置通過。Linux 32通知交錯驗證paid／consumed／單一事件與任務；電商後台路由alias另經Red/Green及逐站啟停實測。八站Caddy預備配置以實際adapter驗證，尚未建立DNS或啟用公開入口。

## CI race 測試時間預算

遠端完整 Go race 測試包含多租戶登入與正式 600,000 次 PBKDF2 密碼驗證；測試數增加後，預設 Go 10 分鐘總逾時已在仍執行密碼雜湊時中斷。保持正式密碼強度與 race detector，不以降低安全設定換取通過；station-delivery job 使用明確 25 分鐘 Go 測試逾時及 35 分鐘工作逾時，仍可偵測卡死。後續由遠端 CI 確認耗時與結果，不能以延長逾時宣稱測試通過。

## 穩定版合併與部署

每版完成且遠端必要檢查通過後，確認 PR 精確提交、目標 `main` 和合併狀態，再合併至 `main`，由 GitHub Actions 執行正式部署。部署及公開站台結果由子代理追蹤；合併、CI 通過與正式部署成功是不同狀態，必須分別記錄。若檢查失敗或尚在執行，先修正或等待，不將未驗證版本稱為穩定版。使用者要求不在本機執行測試。
