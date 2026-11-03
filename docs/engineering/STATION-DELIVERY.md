# Linux 分站交付包

解壓後，以專用非 root 使用者在交付目錄啟動：

```sh
mkdir -p /var/lib/business-suite
SUITE_WEB="$PWD/web-dist" SUITE_DB=/var/lib/business-suite/stations.sqlite SUITE_ADDR=127.0.0.1:8095 ./station-server
```

此二進位與 `web-dist` 必須來自同一個 GitHub Actions artifact；`COMMIT` 記錄來源版本。以受控代理提供 HTTPS，設定主站建置變數 `NEXT_PUBLIC_STATION_URL` 為實際分站 URL。既有資料庫必須先備份，不要用 CI artifact 覆寫資料。

此版本包含分站登入／授權、查詢、列印與部分業務交易；功能遷移狀態及限制見 `docs/engineering/WORKSPACE_REFACTOR.md`。分站資料庫與既有 Node 展示站資料庫彼此獨立，並未自動搬移資料。測試帳號與自動建立展示企業僅供示範，不能作為正式身分系統。

升版前可設定 `SUITE_DB` 後執行 `./station-server --backup /var/lib/business-suite/snapshot.sqlite`，以 SQLite 線上快照保存目前資料；目標檔案必須尚不存在。快照不會自動還原，還原時應先停止寫入並確認還原時間點。
