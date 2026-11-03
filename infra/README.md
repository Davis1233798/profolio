# 集中式基礎設施

`sites.json` 是六分站登錄表，`compose.yaml` 是可執行的服務層 IaC；Web 可使用 Workers/D1，或透過 Linux Node 適配器使用持久化 SQLite。
主站 `/platform` 顯示配置，CLI 是實際操作端。變更配置透過 Git 審查，展示 cookie 不授予主機管理權。

```powershell
Copy-Item infra/.env.example infra/.env
# 填入 URL-safe 隨機 SERVICE_PASSWORD 與 GATEWAY_TOKEN（至少 32 字元）
npm run infra:plan
npm run infra:up
node scripts/infra.mjs status
node scripts/infra.mjs logs shop
node scripts/infra.mjs stop
```

也可 `node scripts/infra.mjs up mes` 依分站啟動依賴。停止不刪除持久化 volume。
修改 SQL 初始化檔只影響全新 volume；既有資料必須另作版本化 migration，不能以刪除 volume 升級。

## Web 接線

伺服器環境綁定 `INFRA_GATEWAY_URL`、`INFRA_GATEWAY_TOKEN`。本機 gateway 綁定 `127.0.0.1:8088`；部署 Workers 時需要獨立、可透過 HTTPS 存取的服務入口。憑證只放執行環境，不能用 `NEXT_PUBLIC_*` 或寫入 Sites source manifest。

- 電商只緩存描述資料，TTL 30 秒；價格、規格與庫存不緩存。Redis 故障回退 D1。
- 付款成功與 `shop.paid` Outbox 同一 D1 batch；Workers scheduled handler 派送每批 25 筆。部署環境需設定每分鐘 cron `* * * * *`；既有 Sites 工具尚未提供此容器平台，不能視為自動接通。
- RabbitMQ 持久消息、publisher confirms、prefetch=8、租戶／事件交易去重；處理失敗最多一次重新派送，之後進 `commerce.dead`。消費端目前建立待處理履約任務，不會呼叫物流或寄信。
- Outbox 發送失敗最多嘗試 10 次，之後保留 pending 供人工查核；查明原因後重設 retry_count 才重送。消息可能重複投遞，消費端不能移除去重。
- MES `/mes/industrial` 只代理登入展示組織的讀取；MQTT topic `factory/{tenant}/{device}/telemetry`，payload 為 `event_id, tenant, device, timestamp, value`。
- MQTT 認證與 topic/payload 一致性目前為內部開發服務配置；正式設備部署需每設備憑證、ACL 及 TLS。目前不對主機暴露 MQTT port。
- TimescaleDB 每日 chunk、90 日保留；去重表不自動清理，以防舊事件重新入庫。統計 3σ 基線不是訓練好的預測維護模型。
- PostgreSQL `SHA256(tenant)[:8] % 2` 為固定 v1 路由；兩個獨立實體資料庫，各自 `mes_work_orders` 再做 4 個 Hash 分區。MES 交易主庫仍為 D1／SQLite。
- MES 已透過 `0003_mes_projection.sql` 交易內觸發器，將既有與新增工單、報工、品檢等異動排入同步 Outbox。每分鐘派送到 PostgreSQL 分片查詢模型，使用單調版本及 tombstone 阻擋亂序資料與刪除後復活；`/mes/industrial` 讀取此模型。原有交易仍在 D1／SQLite，這是持續同步的查詢副本，不是交易主庫換庫。
- 擴充分片需雙寫、搬遷、核對、切換與回滾計畫；不能直接改模數。跨租戶報表需聚合查詢兩庫。

## 驗證

```powershell
python -m unittest discover -s infra/tests -v
python infra/tests/smoke.py
npm run build
npm run infra:preview
# 另一終端驗證 Web 付款到隊列消費的完整路徑（只可用於本機）
node scripts/smoke-infrastructure-web.mjs
npm run engineering:check
```

開發環境不等於高可用生產叢集。正式環境需依目標主機、網域、備份與監控部署；高併發容量須實測。

Linux 整站包：先建置，再執行 `python scripts/package-linux.py`。封裝會排除 `.env`、`.dev.vars`、資料庫與連結，輸出 SHA-256 收據。正式主機獨立產生服務密碼，不沿用本機測試憑證。

`MES_PUBLIC_ROUTE` 未設定或設為 `shared` 時，`mes.<BASE_DOMAIN>` 維持既有 `web:8080` upstream。受控切換可選擇 `isolated` Docker network 或 `rootless` 固定 Unix socket；rootless Caddy 僅掛載 `/run/mes-ingress` 唯讀目錄，切換前必須通過 Unix socket Go health。詳見 [MES ingress 架構與界線](../docs/engineering/MES_UNIX_INGRESS.md) 及 [MES 公開路由安全切換](../docs/engineering/MES_PUBLIC_ROUTE_CUTOVER.md)。

配置依據：[Compose 啟動順序](https://docs.docker.com/compose/how-tos/startup-order/)、[PostgreSQL 分區](https://www.postgresql.org/docs/17/ddl-partitioning.html)、[RabbitMQ confirms](https://www.rabbitmq.com/docs/confirms)。
