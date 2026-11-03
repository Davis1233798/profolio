# MES 公開路由安全切換

## 範圍與目前狀態

主站中央 IaC 管理 `mes.<BASE_DOMAIN>` 的 Caddy upstream。預設仍指向既有 `web:8080`，保留目前 MES 公開流量及主站 `/mes` 路由。切換到 `isolated` 時，才將這個 hostname 指向獨立 repo 的 Go station `mes-station:8095`。

Go station 使用獨立 Compose project `business-suite-mes`、service `mes-station`、volume `business-suite-mes-station-data`，其 host loopback port 是 `127.0.0.1:18095`。Go HTTP server 在容器內 listen `0.0.0.0:8095`。中央 Caddy 位於另一個 Docker 網路，因此不得把 host 的 loopback URL 當成容器 upstream；isolated 模式須將 Caddy edge 加入 MES 專案建立的 `business-suite-mes_default` external network，並以 Compose 服務名稱連線。

Go `GET /api/health` 的成功回應為 HTTP 200 JSON `{ "success": true, "data": { "backend": "go", "status": "ready" } }`；資料庫 ping 失敗回 HTTP 503。公開健康探測依此 JSON 判斷，不依賴自訂 response header。

## 安全邊界

- `MES_PUBLIC_ROUTE` 僅接受 `shared` 或 `isolated`；未設定等同 `shared`。上游只由程式映射為固定值 `web:8080` 或 `mes-station:8095`，不能直接從設定接受任意 host、port 或 URL。
- 只在 isolated 模式套用 edge network overlay。共享模式不要求 MES external network 存在，也不改變 Caddy 的既有 Docker 網路。
- 僅 `mes.<BASE_DOMAIN>` 切換 upstream。根網域、其餘分站、`station.<BASE_DOMAIN>` 與其服務維持原配置。
- Go station 專案的 loopback port、Compose project、SQLite volume、部署目錄與資料均不由中央 IaC 修改。不得掛載、複製、清除或遷移中央 `web-data` 或 `business-suite-mes-station-data`；資料移轉另案規劃及授權。
- 不使用 host networking、不新增公網 port、不改 DNS/TLS、不操作正式主機。中央部署回滾只恢復 Caddy route mode，不回復或改寫 MES SQLite。
- GitHub PR workflow 可驗證配置和隔離測試服務；正式公開 HTTPS 驗收仍需在獨立遠端環境執行，PR CI 不是正式 hostname 可用性的證明。

## 切換與回滾

1. 讀取並驗證唯一 `MES_PUBLIC_ROUTE` 設定；複數、非法值或無效 Compose 設定立即拒絕，不動容器。
2. 要求 MES external network `business-suite-mes_default` 存在且帶有 `com.docker.compose.project=business-suite-mes` 標籤；確認恰有一個 `mes-station` service container 且狀態 healthy。
3. 先從主機 loopback 查 `http://127.0.0.1:18095/api/health`，要求 Go health JSON 為 `ready`。驗證切換後的 Caddyfile，再原子更新共享環境檔中的 route mode。
4. 僅重建中央 `edge`。切換完成後由外部 HTTPS probe 查 `https://mes.<BASE_DOMAIN>/api/health`，要求同一 Go health JSON。其他中央 service 和兩邊資料 volumes 不參與這次操作。
5. 任一步驟失敗，將原 route mode 原子還原、按原模式重建 edge，並再次查原公開 health。若回滾的公開健康驗證失敗，明確回報需人工介入；不刪除 volume，也不假裝回滾成功。

遠端回歸測試需驗證預設 shared、enum allowlist、外部 network 只在 isolated 模式加入、mes hostname upstream 映射、其他 hostname 仍走 web、Go health JSON 判斷，以及失敗時 route mode 可回復。測試使用唯一暫存 Compose project、network 與服務；不得連線正式 MES hostname。
