# 公開部署版本識別

## 架構與邊界

Go 站台建置時將 CI 提交 SHA 嵌入執行檔；`GET /api/health` 在資料庫健康時回報 `revision`，只接受 40 位小寫十六進位提交 ID，其他輸入顯示 `unknown`。不回報環境變數、主機路徑、憑證或個人資料。版本來自已部署的二進位而非瀏覽器資產檔名。OCI 部署依 release SHA 提供 Docker build argument；回滾沿用前版映像中的識別，不受目前部署環境變數影響。非 CI 或桌面開發建置可顯示 `unknown`。

## 測試與驗收

先測有效 SHA、空值、錯誤格式及健康 API 回應，遠端 CI 再驗證 build、部署與公開 HTTPS 端點；健康端點只能證明 Go 站台二進位版本，不代表首頁或全部業務／裝置驗收完成。

OCI 切換完成前，部署腳本須取得公開 Go 健康回應，驗證 `success=true`、`backend=go`、`status=ready` 且 `revision` 等於本次提交；錯誤、缺值或非 JSON 均視為部署驗證失敗並走既有映像回滾。先測相符、不同版本、缺欄、未就緒與無效 JSON，再接部署腳本；這仍不等同首頁或其他網域版本已驗證。

部署以 release 目錄內只含公開 SHA 的 `.revision.env` 作為第二個 Compose env file；不依賴 sudo 保留呼叫端環境，也不修改共用機密 env。舊版 release 若沒有該檔，回滾使用其原設定及舊映像。遠端 CI 以實際 Docker Compose 設定解析驗證 SHA 覆寫及預設值；映像 build 與公開端點仍須在部署後驗證。
