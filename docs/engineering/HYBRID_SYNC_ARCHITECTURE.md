# 雲地混合架構資料同步規格書 (Hybrid Cloud-Edge Data Synchronization Architecture)

## 1. 架構背景與挑戰

在大型企業與製造/門市場景中，系統需同時支援**雲端中央營運**（OCI 雲端集中容器服務）與**地端邊緣離線運作**（Windows 原生 Rust 桌面端與現場 Go + SQLite 本機服務）。

當雲端與地端並行運作時，主要會面臨以下核心技術挑戰：

1. **雙向併發寫入與資料衝突 (Bidirectional Concurrent Writes & Conflicts)**：
   地端在斷網離線時繼續開單、扣庫存、排工單；同時雲端總部也在更新主檔、調撥庫存或變更訂單狀態。若連線恢復時單純採用「最後寫入勝出 (Last-Write-Wins, LWW)」，會造成資料被無預警覆蓋（Lost Updates）以及庫存超賣等嚴重業務問題。
2. **分散式主鍵衝突 (Distributed Key Collisions)**：
   本機 SQLite 常用的自增長主鍵（Auto-Incrementing Integer ID）在多個獨立運行的地端與雲端實例間必然發生主鍵碰撞。
3. **交易一致性與離線變更捕獲 (Transactional CDC & Outbox)**：
   現場業務寫入與網路同步無法在分散式環境下維持單一 2PC 交易。若僅在記憶體中排程發送，一旦當機將造成資料遺失。
4. **網路斷線、重連衝擊與回壓控制 (Network Partitioning & Backpressure)**：
   現場可能斷網數小時或數天，累積數萬筆資料。重新連線時大量並發請求容易衝垮雲端同步 API（Thundering Herd）。
5. **綱要演進與版本相容性 (Schema Divergence & Versioning)**：
   雲端與各分店/廠區的地端軟體更新時程可能不一致，容易發生欄位不相容問題。
6. **零信任端點隔離與資料外洩防範 (Zero-Trust Edge Isolation & Security)**：
   避免地端實體設備失竊或被反組譯後，能偽造跨組織或跨分店的同步請求。

---

## 2. 核心解決架構設計

```
+-----------------------------------------------------------------------------------+
|                            雲端中央營運層 (Cloud Core)                            |
|       PostgreSQL / TimescaleDB / RabbitMQ / Cloud Go Ingestion API                |
+-----------------------------------------------------------------------------------+
                     ▲                                    │
    1. 邊緣業務事件推送 (Push Outbox Batch)                │ 2. 雲端主檔下行廣播 (Downstream Broadcast)
    - 附帶 Idempotency Key 冪等鍵                          │ - 增量快照 (Incremental Deltas)
    - 數值相對增量 (Delta Adjustments)                     │ - 組織角色、權限、價格表、BOM版本
                     │                                    ▼
+-----------------------------------------------------------------------------------+
|               雲地同步閘道 (Zero-Trust Hybrid Sync Gateway)                        |
|   - 裝置 Token 鑑別 (X-Suite-Device-Token)                                        |
|   - 租戶與站台範圍約束 (Tenant/Station Authorization Filter)                      |
|   - 語意衝突裁決引擎 (Semantic Conflict Arbiter)                                  |
+-----------------------------------------------------------------------------------+
                     ▲                                    │
                     │                                    ▼
+-----------------------------------------------------------------------------------+
|                    地端邊緣實例 (On-Premises Edge Desktop / Factory)              |
|                                                                                   |
|  [ 業務交易 (Tx) ] ---> 同步原子寫入 ---> [ sync_outbox (Transactional CDC) ]    |
|         │                                               │                         |
|         ▼                                               ▼                         |
|  [ 本機 SQLite ]                                [ 本機同步守護進程 (Sync Engine) ] |
|  - AES-256 加密存儲                             - 指數退避與斷網重試              |
|  - UUIDv7 分散式主鍵                            - 衝突隔離表 (sync_conflicts)     |
+-----------------------------------------------------------------------------------+
```

---

## 3. 領域職責與權威源劃分 (Domain Ownership & Partitioning)

為避免無序衝突，系統按領域屬性嚴格劃分**單一權威寫入源 (Single Source of Truth)**：

| 領域資料 (Domain Entity) | 權威寫入源 (Authority) | 同步方向 | 衝突解決原則 (Conflict Strategy) |
| :--- | :--- | :--- | :--- |
| **主檔資料**（商品規格、價格、BOM配方、帳號與全域權限、會計科目） | **雲端總部 (Cloud)** | 雲端 $\rightarrow$ 地端 | **雲端勝出 (Cloud-Wins)**：地端維護下行快取複本，以 `version` 為準無條件更新。 |
| **現場交易**（MES 工單報工、品檢處置、機台遙測日誌） | **地端現場 (Edge)** | 地端 $\rightarrow$ 雲端 | **地端勝出 (Edge-Wins)**：雲端作為事件攝入儲存（Event Sourcing），不得修改現場報工數據。 |
| **現場銷售**（POS 收銀交易、開班交班、餐飲桌位出菜單） | **地端門市 (Edge)** | 地端 $\rightarrow$ 雲端 | **地端勝出 (Edge-Wins)**：現場發票與交易唯一且終局，雲端僅做財務匯總。 |
| **協同資源**（實體庫存數量、原料批次存量） | **雲地共同維護 (Shared)** | 雙向雙軌 | **增量合併 (Delta-Merge)**：禁止絕對值覆寫；地端送出扣減量（如 `delta: -3`），由雲端與地端各自依序累計。 |
| **客戶資料與商機**（CRM Leads / Opportunities） | **雙向協同 (Shared)** | 雙向雙軌 | **狀態機晉級 (State Machine Ordering)**：高階狀態（如 `won`/`lost`）強制覆蓋低階狀態（如 `contacted`）；欄位衝突寫入隔離區。 |

---

## 4. 六大技術機制落地規格

### 4.1 分散式唯一識別碼 (Distributed UUIDv7)
所有資料表主鍵一律禁止使用單純自增長整數，改為使用**具備時間排序特性的 UUIDv7**，格式為：
```text
{entity_prefix}_{timestamp_ms_hex}_{node_id}_{random_seq}
範例：ord_018e47f2a1b0_node42_893fa1b
```
優勢：
- 離線建立之單據保證全域唯一，同步至雲端時絕不發生 Primary Key 重複。
- 天然具備時間排序特性，在 SQLite 與 PostgreSQL B-Tree 索引中插入效率高，無碎片化問題。

### 4.2 交易式寄件匣模式 (Transactional Outbox Pattern)
所有引起業務資料變更的 SQL 操作，必須在同一個本地 SQLite 交易中寫入 `sync_outbox` 表：
```sql
BEGIN TRANSACTION;
  -- 1. 業務資料寫入
  INSERT INTO mes_work_orders (id, order_no, status, ...) VALUES (...);
  
  -- 2. 同步事件原子寫入 Outbox
  INSERT INTO sync_outbox (
    id, organization_id, entity_type, entity_id, operation,
    payload, schema_version, idempotency_key, created_at, status
  ) VALUES (
    'sync_018e...', 'org_test', 'mes.work_order', 'wo_018e...', 'INSERT',
    '{"orderNo":"WO-2026-001", "status":"running"}', 1,
    'idemp_sha256_hash...', 1794110712000, 'pending'
  );
COMMIT;
```
若應用程式崩潰或斷電，業務資料與 Outbox 同時提交或同時回滾，徹底消滅「業務有存但未記錄同步」的幽靈狀態。

### 4.3 冪等性與精確一次處理 (Idempotency & Exactly-Once Ingestion)
每次網路重試時可能重複發送相同的變更封包。同步模組利用 `idempotency_key` 進行防護：
```sql
INSERT INTO sync_inbox (id, organization_id, idempotency_key, applied_at)
VALUES (?, ?, ?, ?)
ON CONFLICT (idempotency_key) DO NOTHING;
```
若重複發送，同步閘道將直接回傳 `status: deduplicated_ok`，不重複觸發庫存扣減或過帳。

### 4.4 衝突檢驗與隔離暫存 (Quarantine & Review Queue)
對於無法自動判定的衝突（例如：雲端與地端在斷網期間同時修改了同一個客戶的合約名稱與發票統編）：
1. 系統自動攔截該筆變更，寫入 `sync_conflicts` 隔離資料表：
   - `id`: 衝突單元編號
   - `entity_type`, `entity_id`: 衝突實體
   - `local_payload`: 地端本地版本
   - `remote_payload`: 雲端傳入版本
   - `conflict_reason`: 衝突原因（如 `concurrent_field_divergence`）
   - `resolution_status`: `pending_review` / `resolved_local` / `resolved_remote`
2. **不阻斷原則**：其他無衝突的資料記錄照常繼續同步，絕不因單筆資料卡死整條同步管線。
3. **管理員處置**：Portal 與後台提供「衝突檢視審核抽屜」，管理員可一鍵比對並裁決採納地端或雲端版本。

### 4.5 網路斷線回壓與階梯式重試 (Backpressure & Jittered Retry)
1. **心跳探測 (Heartbeat)**：以 30 秒間隔輕量探測 `/api/sync/health`。
2. **分頁傳輸 (Chunked Batch Streaming)**：每次傳送限制為 50~100 筆事件，防止連線初期耗盡記憶體。
3. **指數退避 (Exponential Backoff with Jitter)**：
   $$\text{RetryInterval} = \min(60\text{s}, 2^{\text{retries}} \times 1\text{s}) \pm \text{RandomJitter}$$
4. **有效負載壓縮 (Payload Gzip Compression)**：大於 1KB 的批次內容預設以 GZIP 壓縮傳輸。

### 4.6 零信任設備配對與權限隔離 (Zero-Trust Device Authorization)
地端於註冊時獲取專屬 `device_sync_token`。雲端同步 API 嚴格驗證：
- 該 Token 僅限存取該裝置註冊綁定之 `organization_id`。
- 地端不得請求或推送非本站台（Site）所屬的數據。

---

## 5. 資料表綱要 (Sync Schema)

```sql
-- 1. 地端發送寄件匣 (Transactional Outbox)
CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,         -- INSERT, UPDATE, DELETE, DELTA
  payload TEXT NOT NULL,            -- JSON 快照或變更集
  schema_version INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, in_flight, synced, failed
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT DEFAULT ''
);

-- 2. 接收處理紀錄 (Idempotent Inbox)
CREATE TABLE IF NOT EXISTS sync_inbox (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL
);

-- 3. 衝突隔離審核表 (Conflict Quarantine)
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_payload TEXT NOT NULL,
  remote_payload TEXT NOT NULL,
  conflict_reason TEXT NOT NULL,
  resolution_status TEXT NOT NULL DEFAULT 'pending_review', -- pending_review, resolved_local, resolved_remote
  created_at INTEGER NOT NULL,
  resolved_at INTEGER DEFAULT 0,
  resolved_by TEXT DEFAULT ''
);
```
