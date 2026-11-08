import React, { useState, useEffect, useMemo } from 'react';
import { tr } from './locale';

export type LicensePayload = {
  id: string;
  customer: string;
  contact: string;
  hwid: string;
  modules: string[];
  issuedAt: number;
  expiresAt: number;
  tier: string;
};

export type LicenseStatusResponse = {
  license: LicensePayload;
  isExpired: boolean;
  expiresAtFormatted: string;
  issuedAtFormatted: string;
  remainingDays: number;
};

export type AuditLogEntry = {
  id: string;
  timestamp: number;
  timeString: string;
  userId: string;
  email: string;
  displayName: string;
  action: string;
  module: string;
  deviceId: string;
  ipAddress: string;
  status: string;
  details: string;
};

export type Identity = {
  userId: string;
  organizationId: string;
  email: string;
  name: string;
  grants: { site: string; role: string; scope: string; enabled: boolean }[];
};

export type SyncStatusResponse = {
  syncMode: string;
  pendingOutbox: number;
  syncedCount: number;
  activeConflicts: number;
  lastSyncTimestamp: number;
  lastSyncFormatted: string;
  health: string;
};

export type SyncConflictEntry = {
  id: string;
  organizationId: string;
  entityType: string;
  entityId: string;
  localPayload: string;
  remotePayload: string;
  conflictReason: string;
  resolutionStatus: string;
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
};

export type PortalTab = 'modules' | 'sso' | 'audit' | 'license' | 'sync';

const stationModules = [
  {
    key: 'mes',
    name: 'ForgeFlow MES',
    zhName: '智能製造執行系統',
    category: 'manufacturing',
    desc: '工單排程、物料批次追蹤、BOM版本管理、成品檢驗處置與現場工控監測',
    tags: ['工單排程', 'BOM配方', '物料批次', '成品處置', '工控數據'],
    entryUrl: '/mes/back',
    scope: 'back',
    color: '#0284c7',
  },
  {
    key: 'erp',
    name: 'LedgerWorks ERP',
    zhName: '企業資源規劃系統',
    category: 'finance',
    desc: '多倉庫存調撥、採購核准入庫、銷售出貨過帳、財務會計總帳與MES成品整合入庫',
    tags: ['庫存調撥', '採購核准', '銷售出貨', '財務總帳', 'MES整合'],
    entryUrl: '/erp/back',
    scope: 'back',
    color: '#4f46e5',
  },
  {
    key: 'crm',
    name: 'RelationDesk CRM',
    zhName: '客戶關係與商機管理',
    category: 'sales',
    desc: '潛在客戶開發、商機階段看板、多版本報價審核、客戶個資與支援服務單',
    tags: ['商機看板', '版本報價', '客戶合約', '個資合規', '服務工單'],
    entryUrl: '/crm/back',
    scope: 'back',
    color: '#7c3aed',
  },
  {
    key: 'shop',
    name: 'MarketLane Commerce',
    zhName: '數位全通路電商平台',
    category: 'retail',
    desc: '多規格商品型錄、購物車模擬結帳、即時履約配送與售後退貨折讓審核',
    tags: ['商品型錄', '多規格購物車', '履約配送', '售後退換'],
    entryUrl: '/shop/back',
    scope: 'back',
    color: '#db2777',
  },
  {
    key: 'pos',
    name: 'CounterPoint POS',
    zhName: '智慧門市收銀系統',
    category: 'retail',
    desc: '高速條碼掃描結帳、開班交班結算、掛單保留作業與熱感發票即時列印',
    tags: ['條碼掃描', '開收班交班', '掛單保留', '收銀發票'],
    entryUrl: '/pos/front',
    scope: 'front',
    color: '#059669',
  },
  {
    key: 'dining',
    name: 'TableCraft Dining',
    zhName: '智慧餐飲與廚房調度',
    category: 'retail',
    desc: '現場桌位動態圖、廚房KDS即時出菜點單、分單拆單結帳與外帶退單作業',
    tags: ['現場桌位', '廚房KDS', '即時出菜', '分單結帳', '外帶退單'],
    entryUrl: '/dining/front',
    scope: 'front',
    color: '#d97706',
  },
];

const demoOperators = [
  {
    email: 'admin@suite.test',
    password: 'SuiteDemo!2026',
    name: '系統管理員 Administrator',
    roleLabel: '全系統最高權限 (Admin)',
    desc: '擁有全模組管理、資料備份稽核與系統授權設定權限',
    badge: '👑 最高管理員',
  },
  {
    email: 'office@suite.test',
    password: 'SuiteDemo!2026',
    name: '後台營運主管 Back-Office Lead',
    roleLabel: '後台營運主管 (Operator)',
    desc: '執行日常製造工單、庫存調撥、採購核准與財務過帳',
    badge: '💼 營運主管',
  },
  {
    email: 'front@suite.test',
    password: 'SuiteDemo!2026',
    name: '前台服務人員 Front-Office Lead',
    roleLabel: '門市與外場人員 (Front)',
    desc: '專職現場門市 POS 收銀、餐飲帶位點餐與電商前台',
    badge: '🛒 現場服務',
  },
  {
    email: 'viewer@suite.test',
    password: 'SuiteDemo!2026',
    name: '安全合規稽核人員 Security Auditor',
    roleLabel: '安全合規稽核 (Read-Only)',
    desc: '安全合規審查、系統操作軌跡與唯讀報表檢視',
    badge: '🛡️ 安全稽核',
  },
];

const SAMPLE_KEYS = {
  full: 'BSLIC-V1-eyJpZCI6IkxJQy0xNzk0MTEwNzEyLTMyMDg0IiwiY3VzdG9tZXIiOiLlj7DngaPlhYjpgLLmmbrog73oo73pgKDogqHku73mnInpmZDlhazlj7giLCJjb250YWN0IjoiYWRtaW5A5Y+w54Gj5YWI6YCy5pm66IO96KO96YCg6IKh5Lu95pyJ6ZmQ5YWs5Y+4LmNvbSIsImh3aWQiOiJBTlkiLCJtb2R1bGVzIjpbImVycCIsIm1lcyIsImNybSIsInNob3AiLCJwb3MiLCJkaW5pbmciXSwiaXNzdWVkQXQiOjE3OTQxMTA3MTIsImV4cGlyZXNBdCI6MTgyNTY0NjcxMiwidGllciI6ImVudGVycHJpc2VfdW5saW1pdGVkIn0=.3a05641d0e626ed593f8afbb41ee17dc31605f5ba15abdd1d64b7234cc8f82a1',
  partial: 'BSLIC-V1-eyJpZCI6IkxJQy0xNzk0MTEwNzEyLTUzOTciLCJjdXN0b21lciI6IuaWsOerueaZuuiDveapn+aisOiCoeS7veaciemZkOWFrOWPuCIsImNvbnRhY3QiOiJhZG1pbkDmlrDnq7nmmbrog73mqZ/morDogqHku73mnInpmZDlhazlj7guY29tIiwiaHdpZCI6IkFOWSIsIm1vZHVsZXMiOlsibWVzIiwiZXJwIl0sImlzc3VlZEF0IjoxNzk0MTEwNzEyLCJleHBpcmVzQXQiOjE4MDk2NjI3MTIsInRpZXIiOiJlbnRlcnByaXNlX3VubGltaXRlZCJ9.ec3b6637f007997e4ed2abe6f1bdffdd61b2281ec7aa8afa9038c5c259d8b75b',
  expired: 'BSLIC-V1-eyJpZCI6IkxJQy0xNzk0MTEwNzEyLTQ3NjQzIiwiY3VzdG9tZXIiOiLliLDmnJ/npLrnr4TkvIHmpa3ogqHku73mnInpmZDlhazlj7giLCJjb250YWN0IjoiYWRtaW5A5Yiw5pyf56S656+E5LyB5qWt6IKh5Lu95pyJ6ZmQ5YWs5Y+4LmNvbSIsImh3aWQiOiJBTlkiLCJtb2R1bGVzIjpbImFsbCJdLCJpc3N1ZWRBdCI6MTc5MTUxODcxMiwiZXhwaXJlc0F0IjoxNzk0MDI0MzEyLCJ0aWVyIjoiZW50ZXJwcmlzZV91bmxpbWl0ZWQifQ==.0ecd6f2b03bcdeea9d5a54dd1f54e150894f087bb1710ecb88ec2921a3c71f45',
};

export function PortalDashboard({
  identity,
  onIdentityChange,
}: {
  identity: Identity | null;
  onIdentityChange: () => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<PortalTab>('modules');
  const [moduleCategory, setModuleCategory] = useState<string>('all');
  const [licenseInfo, setLicenseInfo] = useState<LicenseStatusResponse | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditFilterAction, setAuditFilterAction] = useState<string>('all');
  const [auditFilterModule, setAuditFilterModule] = useState<string>('all');
  const [auditSearchQuery, setAuditSearchQuery] = useState<string>('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [newLicenseKey, setNewLicenseKey] = useState('');
  const [licenseMsg, setLicenseMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse | null>(null);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflictEntry[]>([]);
  const [syncMsg, setSyncMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // Load license status
  const loadLicense = async () => {
    try {
      const res = await fetch('/api/license/status', { credentials: 'same-origin' });
      const json = (await res.json()) as any;
      if (json.success && json.data) {
        setLicenseInfo(json.data);
      }
    } catch (e) {
      console.error('Failed to load license', e);
    }
  };

  // Load audit logs
  const loadAuditLogs = async () => {
    try {
      const res = await fetch('/api/audit/logs?limit=100', { credentials: 'same-origin' });
      const json = (await res.json()) as any;
      if (json.success && json.data?.logs) {
        setAuditLogs(json.data.logs);
      }
    } catch (e) {
      console.error('Failed to load audit logs', e);
    }
  };

  // Load sync status
  const loadSyncStatus = async () => {
    try {
      const res = await fetch('/api/sync/status', { credentials: 'same-origin' });
      const json = (await res.json()) as any;
      if (json.success && json.data) {
        setSyncStatus(json.data);
      }
    } catch (e) {
      console.error('Failed to load sync status', e);
    }
  };

  // Load sync conflicts
  const loadSyncConflicts = async () => {
    try {
      const res = await fetch('/api/sync/conflicts', { credentials: 'same-origin' });
      const json = (await res.json()) as any;
      if (json.success && json.data?.conflicts) {
        setSyncConflicts(json.data.conflicts);
      }
    } catch (e) {
      console.error('Failed to load sync conflicts', e);
    }
  };

  useEffect(() => {
    void loadLicense();
    void loadAuditLogs();
    void loadSyncStatus();
    void loadSyncConflicts();

    const handleShutdown = () => {
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/desktop/shutdown');
        } else {
          fetch('/api/desktop/shutdown', { method: 'POST', keepalive: true }).catch(() => {});
        }
      } catch (e) {
        // ignore
      }
    };
    window.addEventListener('beforeunload', handleShutdown);
    window.addEventListener('pagehide', handleShutdown);
    return () => {
      window.removeEventListener('beforeunload', handleShutdown);
      window.removeEventListener('pagehide', handleShutdown);
    };
  }, []);

  useEffect(() => {
    if (activeTab === 'audit') {
      void loadAuditLogs();
    }
    if (activeTab === 'sync') {
      void loadSyncStatus();
      void loadSyncConflicts();
    }
  }, [activeTab]);

  // Trigger manual sync roundtrip
  const handleTriggerSync = async () => {
    setBusy(true);
    setSyncMsg(null);
    try {
      // 1. Push pending batch
      const pushRes = await fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
      });
      const pushData = (await pushRes.json()) as any;
      if (!pushRes.ok || !pushData.success) {
        throw new Error(pushData.error?.message || '推送變更批次失敗');
      }

      const pushedItems = pushData.data?.batch || [];
      const ids = pushedItems.map((it: any) => it.id);

      // 2. Acknowledge pushed items
      if (ids.length > 0) {
        const ackRes = await fetch('/api/sync/ack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ ids }),
        });
        const ackData = (await ackRes.json()) as any;
        if (!ackRes.ok || !ackData.success) {
          throw new Error(ackData.error?.message || '確認同步狀態失敗');
        }
      }

      setSyncMsg({
        text: `雲地同步完成！已成功推送 ${ids.length} 筆邊緣異動事件至中央同步節點。`,
        ok: true,
      });
      await loadSyncStatus();
      await loadAuditLogs();
    } catch (err: any) {
      setSyncMsg({ text: err.message || '同步執行失敗', ok: false });
    } finally {
      setBusy(false);
    }
  };

  // Simulate concurrent conflict to demonstrate quarantine mechanism
  const handleSimulateConflict = async () => {
    setBusy(true);
    setSyncMsg(null);
    try {
      // Send a simulated concurrent remote update
      const res = await fetch('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          items: [
            {
              id: `sim_rem_${Date.now()}`,
              organizationId: identity?.organizationId || 'org_test_default',
              entityType: 'erp.customer_profile',
              entityId: 'cust-simulated-conflict-01',
              operation: 'UPDATE',
              payload: JSON.stringify({
                companyName: '雲端總部異動之客戶名稱',
                creditLimit: 5000000,
                updatedAt: new Date().toISOString(),
              }),
              idempotencyKey: `idemp_sim_${Date.now()}`,
            },
          ],
        }),
      });
      const data = (await res.json()) as any;
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || '模擬衝突失敗');
      }

      setSyncMsg({
        text: `已完成模擬攝入！系統成功處理並寫入日誌（套用: ${data.data.ingested}, 冪等去重: ${data.data.deduplicated}, 衝突隔離: ${data.data.conflicts}）。`,
        ok: true,
      });
      await loadSyncStatus();
      await loadSyncConflicts();
      await loadAuditLogs();
    } catch (err: any) {
      setSyncMsg({ text: err.message || '模擬失敗', ok: false });
    } finally {
      setBusy(false);
    }
  };

  // SSO Login action
  const handleSSOLogin = async (email: string, pass: string, targetRedirect?: string) => {
    setBusy(true);
    setLoginError('');
    try {
      const res = await fetch('/api/auth/sso-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password: pass }),
      });
      const data = (await res.json()) as any;
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || '登入失敗，請確認帳號與密碼');
      }
      await onIdentityChange();
      await loadLicense();
      await loadAuditLogs();
      if (targetRedirect) {
        location.assign(targetRedirect);
      } else {
        setActiveTab('modules');
      }
    } catch (err: any) {
      setLoginError(err.message || '登入失敗');
    } finally {
      setBusy(false);
    }
  };

  // Sign out action
  const handleSignOut = async () => {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
      await onIdentityChange();
      await loadLicense();
      await loadAuditLogs();
    } catch (e) {
      console.error('Logout error', e);
    } finally {
      setBusy(false);
    }
  };

  // Update license action
  const handleUpdateLicense = async () => {
    if (!newLicenseKey.trim()) return;
    setBusy(true);
    setLicenseMsg(null);
    try {
      const res = await fetch('/api/license/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ key: newLicenseKey.trim() }),
      });
      const data = (await res.json()) as any;
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || '金鑰更新失敗');
      }
      setLicenseMsg({ text: '授權金鑰更新成功！新模組已立即啟用。', ok: true });
      setNewLicenseKey('');
      await loadLicense();
      await loadAuditLogs();
    } catch (err: any) {
      setLicenseMsg({ text: err.message || '更新金鑰失敗', ok: false });
    } finally {
      setBusy(false);
    }
  };

  // Check if a module is licensed
  const isModuleLicensed = (modKey: string) => {
    if (!licenseInfo || !licenseInfo.license) return true;
    const mods = licenseInfo.license.modules || [];
    return (
      mods.includes(modKey) ||
      mods.includes('all') ||
      mods.includes('*') ||
      licenseInfo.license.tier === 'enterprise_unlimited'
    );
  };

  // Filter modules
  const filteredModules = useMemo(() => {
    if (moduleCategory === 'all') return stationModules;
    return stationModules.filter((m) => m.category === moduleCategory);
  }, [moduleCategory]);

  // Filter audit logs
  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter((log) => {
      if (auditFilterAction !== 'all' && log.action !== auditFilterAction) return false;
      if (auditFilterModule !== 'all' && log.module.toLowerCase() !== auditFilterModule.toLowerCase()) return false;
      if (auditSearchQuery.trim()) {
        const q = auditSearchQuery.toLowerCase();
        const match =
          log.displayName.toLowerCase().includes(q) ||
          log.email.toLowerCase().includes(q) ||
          log.details.toLowerCase().includes(q) ||
          log.action.toLowerCase().includes(q) ||
          log.module.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [auditLogs, auditFilterAction, auditFilterModule, auditSearchQuery]);

  return (
    <div className="portal-suite-root">
      {/* Top Global Header */}
      <header className="portal-topbar">
        <div className="portal-brand-wrap">
          <div className="portal-brand-icon">BS</div>
          <div>
            <div className="portal-brand-title">BUSINESS SUITE · 企業營運核心管理系統</div>
            <div className="portal-brand-subtitle">
              <span className="live-dot" /> 單一簽入 (SSO) 中央門戶 · 企業級稽核軌跡 · 原生桌面整合
            </div>
          </div>
        </div>

        <div className="portal-topbar-actions">
          <button
            type="button"
            className="portal-sync-pill-btn"
            onClick={() => setActiveTab('sync')}
            title="檢視雲端與地端資料同步狀態與佇列"
          >
            <span className="sync-pulse-dot" />
            <span className="sync-pill-text">雲地同步</span>
            <span className="sync-pill-count">
              {syncStatus ? `${syncStatus.pendingOutbox} 待傳` : '連線中'}
            </span>
          </button>

          {identity ? (
            <div className="portal-operator-badge">
              <div className="operator-avatar">
                {identity.name ? identity.name.charAt(0).toUpperCase() : 'U'}
              </div>
              <div className="operator-details">
                <div className="operator-name">{identity.name || identity.email}</div>
                <div className="operator-email">{identity.email}</div>
              </div>
              <button
                type="button"
                className="btn-portal-danger"
                disabled={busy}
                onClick={() => void handleSignOut()}
              >
                登出
              </button>
            </div>
          ) : (
            <div className="portal-guest-badge">
              <span className="live-pill">🔒 尚未登入</span>
              <button
                type="button"
                className="btn-portal-ghost"
                onClick={() => setActiveTab('sso')}
              >
                前往登入
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="portal-content-wrap">
        {/* Navigation Tabs Bar (按鈕切換分頁) */}
        <nav className="portal-tabs-nav" role="tablist" aria-label="企業門戶分頁切換">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'modules'}
            className={`portal-tab-btn ${activeTab === 'modules' ? 'active' : ''}`}
            onClick={() => setActiveTab('modules')}
          >
            <span className="tab-icon">🚀</span>
            <span className="tab-label">企業子系統門戶</span>
            <span className="tab-pill">6 大模組</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'sso'}
            className={`portal-tab-btn ${activeTab === 'sso' ? 'active' : ''}`}
            onClick={() => setActiveTab('sso')}
          >
            <span className="tab-icon">⚡</span>
            <span className="tab-label">SSO 身分快速登入</span>
            <span className="tab-pill">{identity ? '已登入身分' : '4 組示範角色'}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'audit'}
            className={`portal-tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('audit');
              void loadAuditLogs();
            }}
          >
            <span className="tab-icon">📋</span>
            <span className="tab-label">系統操作稽核軌跡</span>
            <span className="tab-pill">{auditLogs.length} 筆紀錄</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'license'}
            className={`portal-tab-btn ${activeTab === 'license' ? 'active' : ''}`}
            onClick={() => setActiveTab('license')}
          >
            <span className="tab-icon">🔑</span>
            <span className="tab-label">企業授權中心</span>
            <span className="tab-pill">
              {licenseInfo ? `剩餘 ${licenseInfo.remainingDays} 天` : '授權資訊'}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'sync'}
            className={`portal-tab-btn ${activeTab === 'sync' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('sync');
              void loadSyncStatus();
              void loadSyncConflicts();
            }}
          >
            <span className="tab-icon">🔄</span>
            <span className="tab-label">雲地資料同步</span>
            <span className="tab-pill">
              {syncStatus ? `${syncStatus.pendingOutbox} 筆待同步` : '混合架構'}
            </span>
          </button>
        </nav>

        {/* =========================================================================
            TAB 1: 企業子系統門戶 (SUBMODULES)
           ========================================================================= */}
        {activeTab === 'modules' && (
          <section className="portal-tab-pane">
            {/* License Hero Card */}
            {licenseInfo && (
              <section className="portal-license-banner">
                <div className="license-banner-left">
                  <div className="license-tag-row">
                    <span className="license-tag-corp">🏢 {licenseInfo.license.customer}</span>
                    <span className="license-tag-tier">
                      💎 {licenseInfo.license.tier.toUpperCase()}
                    </span>
                    <span
                      className={`license-status-badge ${
                        licenseInfo.isExpired ? 'expired' : 'active'
                      }`}
                    >
                      {licenseInfo.isExpired ? '🔴 授權已到期 (LOCKED)' : '🟢 授權正常啟用中 (ACTIVE)'}
                    </span>
                  </div>
                  <h1 className="portal-hero-title">企業全方位業務子系統整合中心</h1>
                  <p className="portal-hero-desc">
                    單一簽入 (SSO) 連通全部授權子系統。點選對應模組即可直接進入作業，全流程均受安全稽核日誌監控。
                  </p>
                </div>

                <div className="license-banner-right">
                  <div className="license-countdown-box">
                    <div className="countdown-number">{licenseInfo.remainingDays}</div>
                    <div className="countdown-label">授權剩餘天數</div>
                  </div>
                  <div className="license-dates">
                    <div>有效期限：{licenseInfo.expiresAtFormatted.split(' ')[0]}</div>
                    <div>綁定主機：{licenseInfo.license.hwid}</div>
                    <button
                      type="button"
                      className="btn-update-key-small"
                      onClick={() => setActiveTab('license')}
                    >
                      更換 / 升級金鑰
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* Sub-Category Filter Buttons */}
            <div className="portal-filter-bar">
              <span className="filter-label">模組分類：</span>
              <div className="filter-btn-group">
                <button
                  type="button"
                  className={`btn-filter ${moduleCategory === 'all' ? 'active' : ''}`}
                  onClick={() => setModuleCategory('all')}
                >
                  全部模組 ({stationModules.length})
                </button>
                <button
                  type="button"
                  className={`btn-filter ${moduleCategory === 'manufacturing' ? 'active' : ''}`}
                  onClick={() => setModuleCategory('manufacturing')}
                >
                  🏭 製造與排程 (MES)
                </button>
                <button
                  type="button"
                  className={`btn-filter ${moduleCategory === 'finance' ? 'active' : ''}`}
                  onClick={() => setModuleCategory('finance')}
                >
                  📈 進銷存財務 (ERP)
                </button>
                <button
                  type="button"
                  className={`btn-filter ${moduleCategory === 'sales' ? 'active' : ''}`}
                  onClick={() => setModuleCategory('sales')}
                >
                  🤝 客戶與商機 (CRM)
                </button>
                <button
                  type="button"
                  className={`btn-filter ${moduleCategory === 'retail' ? 'active' : ''}`}
                  onClick={() => setModuleCategory('retail')}
                >
                  🛒 門市、電商與餐飲 (POS / Shop / Dining)
                </button>
              </div>
            </div>

            {/* Modules Grid */}
            <div className="modules-grid">
              {filteredModules.map((mod) => {
                const licensed = isModuleLicensed(mod.key);
                return (
                  <div
                    key={mod.key}
                    className={`module-card ${licensed ? 'licensed' : 'unlicensed'}`}
                    style={{ '--mod-accent': mod.color } as React.CSSProperties}
                  >
                    <div className="module-card-header">
                      <div>
                        <div className="module-sys-badge">{mod.key.toUpperCase()}</div>
                        <h3 className="module-sys-title">{mod.name}</h3>
                        <div className="module-zh-title">{mod.zhName}</div>
                      </div>
                      <div className="module-lic-badge">
                        {licensed ? (
                          <span className="badge-licensed">✓ 已授權啟用</span>
                        ) : (
                          <span className="badge-locked">🔒 未購買授權</span>
                        )}
                      </div>
                    </div>

                    <p className="module-desc">{mod.desc}</p>

                    <div className="module-tags">
                      {mod.tags.map((t) => (
                        <span key={t} className="tag-item">
                          {t}
                        </span>
                      ))}
                    </div>

                    <div className="module-card-footer">
                      {licensed ? (
                        identity ? (
                          <a href={mod.entryUrl} className="btn-module-launch">
                            立即進入 {mod.name} →
                          </a>
                        ) : (
                          <button
                            type="button"
                            className="btn-module-launch"
                            disabled={busy}
                            onClick={() =>
                              void handleSSOLogin('admin@suite.test', 'SuiteDemo!2026', mod.entryUrl)
                            }
                          >
                            ⚡ 一鍵 SSO 登入並進入 →
                          </button>
                        )
                      ) : (
                        <button
                          type="button"
                          className="btn-module-locked"
                          onClick={() => setActiveTab('license')}
                        >
                          🔒 方案未包含 (請至授權中心升級)
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* =========================================================================
            TAB 2: SSO 統一身分登入 (SSO PERSONAS)
           ========================================================================= */}
        {activeTab === 'sso' && (
          <section className="portal-tab-pane">
            <div className="sso-section-header">
              <h2>⚡ 選擇操作角色 快速進行 SSO 統一身分登入</h2>
              <p>
                無須於各子系統反覆輸入密碼。點選角色直接登入，系統自動寫入稽核日誌並發布全站通行會話。
              </p>
            </div>

            {identity && (
              <div className="portal-current-session-box">
                <div className="session-info">
                  <span className="session-icon">👤</span>
                  <div>
                    <strong>目前已登入身分：{identity.name}</strong> ({identity.email})
                    <p>授權工作站權限已啟用，點擊上方【企業子系統門戶】即可直接作業。</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-portal-danger"
                  disabled={busy}
                  onClick={() => void handleSignOut()}
                >
                  登出目前身分
                </button>
              </div>
            )}

            {loginError && <div className="portal-alert-error">{loginError}</div>}

            <div className="sso-operator-grid">
              {demoOperators.map((op) => (
                <div
                  key={op.email}
                  className="sso-operator-card"
                  onClick={() => void handleSSOLogin(op.email, op.password)}
                >
                  <div className="op-card-header">
                    <span className="op-badge">{op.badge}</span>
                    <span className="op-role">{op.roleLabel}</span>
                  </div>
                  <h3 className="op-name">{op.name}</h3>
                  <p className="op-desc">{op.desc}</p>
                  <div className="op-card-footer">
                    <code className="op-email">{op.email}</code>
                    <button type="button" className="btn-sso-enter" disabled={busy}>
                      {busy ? '登入中…' : '一鍵 SSO 登入 →'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="sso-manual-box">
              <h3>或使用自訂企業帳號登入 (Custom Account Sign-In)</h3>
              <form
                className="sso-manual-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSSOLogin(loginEmail, loginPassword);
                }}
              >
                <input
                  type="email"
                  placeholder="企業電子郵件 (Email)"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                />
                <input
                  type="password"
                  placeholder="登入密碼 (Password)"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                />
                <button type="submit" disabled={busy} className="btn-manual-submit">
                  {busy ? '驗證中…' : '帳號登入'}
                </button>
              </form>
            </div>
          </section>
        )}

        {/* =========================================================================
            TAB 3: 系統操作稽核軌跡 (AUDIT TRAIL)
           ========================================================================= */}
        {activeTab === 'audit' && (
          <section className="portal-tab-pane">
            <div className="audit-section-header">
              <div>
                <h2>📋 企業登入與操作安全稽核軌跡 (Audit Trail)</h2>
                <p>完整紀錄 SSO 登入、模組存取、授權異動與安全攔截事件，提供符合企業合規之稽核審計台帳。</p>
              </div>
              <button
                type="button"
                className="btn-refresh"
                onClick={() => void loadAuditLogs()}
              >
                🔄 重新整理日誌
              </button>
            </div>

            {/* Audit Filter Toolbar */}
            <div className="audit-toolbar">
              <div className="audit-filter-item">
                <label>操作動作：</label>
                <select
                  value={auditFilterAction}
                  onChange={(e) => setAuditFilterAction(e.target.value)}
                >
                  <option value="all">全部動作 (All Actions)</option>
                  <option value="sso_login">SSO 登入 (sso_login)</option>
                  <option value="sso_logout">SSO 登出 (sso_logout)</option>
                  <option value="access_denied">存取攔截 (access_denied)</option>
                  <option value="license_update">金鑰更新 (license_update)</option>
                </select>
              </div>

              <div className="audit-filter-item">
                <label>系統模組：</label>
                <select
                  value={auditFilterModule}
                  onChange={(e) => setAuditFilterModule(e.target.value)}
                >
                  <option value="all">全部模組 (All Modules)</option>
                  <option value="portal">門戶 (Portal)</option>
                  <option value="mes">MES 製造</option>
                  <option value="erp">ERP 企業資源</option>
                  <option value="crm">CRM 客戶關係</option>
                  <option value="shop">Shop 電商</option>
                  <option value="pos">POS 門市</option>
                  <option value="dining">Dining 餐飲</option>
                </select>
              </div>

              <div className="audit-filter-item search">
                <label>關鍵字搜尋：</label>
                <input
                  type="text"
                  placeholder="搜尋人員、郵件、說明..."
                  value={auditSearchQuery}
                  onChange={(e) => setAuditSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Audit Table */}
            <div className="audit-table-wrap">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>時間 (Timestamp)</th>
                    <th>操作人員 (User)</th>
                    <th>動作 (Action)</th>
                    <th>模組 (Module)</th>
                    <th>設備 / IP</th>
                    <th>狀態 (Status)</th>
                    <th>詳細說明 (Details)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAuditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="time-col">{log.timeString}</td>
                      <td>
                        <strong>{log.displayName || '—'}</strong>
                        <small>{log.email || '—'}</small>
                      </td>
                      <td>
                        <span className={`action-pill ${log.action}`}>{log.action}</span>
                      </td>
                      <td>{log.module.toUpperCase()}</td>
                      <td>
                        <div>{log.deviceId}</div>
                        <small>{log.ipAddress}</small>
                      </td>
                      <td>
                        <span
                          className={`status-pill ${
                            log.status === 'success' ? 'ok' : 'forbidden'
                          }`}
                        >
                          {log.status === 'success' ? '✓ 成功' : '✗ 攔截/失敗'}
                        </span>
                      </td>
                      <td className="details-col">{log.details}</td>
                    </tr>
                  ))}
                  {filteredAuditLogs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="empty-audit">
                        目前尚無符合篩選條件的稽核紀錄
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* =========================================================================
            TAB 4: 企業授權中心 (LICENSE MANAGER)
           ========================================================================= */}
        {activeTab === 'license' && (
          <section className="portal-tab-pane">
            <div className="license-tab-header">
              <h2>🔑 企業授權金鑰管理中心 (License Center)</h2>
              <p>檢視當前企業授權狀態、有效期限、授權模組清單，並可即時更新授權金鑰進行升級或續約。</p>
            </div>

            {licenseInfo && (
              <div className="license-info-card-expanded">
                <div className="license-card-hero">
                  <div>
                    <span className="license-company-pill">企業客戶</span>
                    <h3 className="license-company-name">{licenseInfo.license.customer}</h3>
                    <div className="license-id-sub">
                      授權編號 (ID)：<code>{licenseInfo.license.id}</code> · 聯絡人：
                      {licenseInfo.license.contact}
                    </div>
                  </div>
                  <div className="license-tier-box">
                    <div className="tier-tag">方案等級</div>
                    <div className="tier-name">{licenseInfo.license.tier.toUpperCase()}</div>
                  </div>
                </div>

                <div className="license-stats-grid">
                  <div className="stat-box">
                    <div className="stat-label">授權狀態</div>
                    <div
                      className={`stat-val ${
                        licenseInfo.isExpired ? 'stat-expired' : 'stat-active'
                      }`}
                    >
                      {licenseInfo.isExpired ? '🔴 已到期 (LOCKED)' : '🟢 正常使用中 (ACTIVE)'}
                    </div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-label">剩餘天數</div>
                    <div className="stat-val highlight">{licenseInfo.remainingDays} 天</div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-label">有效截止日期</div>
                    <div className="stat-val">{licenseInfo.expiresAtFormatted}</div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-label">硬體綁定 (HWID)</div>
                    <div className="stat-val code">{licenseInfo.license.hwid}</div>
                  </div>
                </div>

                <div className="license-modules-matrix">
                  <h4>📦 方案模組授權啟用狀況：</h4>
                  <div className="matrix-grid">
                    {stationModules.map((m) => {
                      const enabled = isModuleLicensed(m.key);
                      return (
                        <div
                          key={m.key}
                          className={`matrix-item ${enabled ? 'enabled' : 'disabled'}`}
                        >
                          <span className="matrix-icon">{enabled ? '✓' : '🔒'}</span>
                          <div>
                            <strong>{m.name}</strong>
                            <small>{m.zhName}</small>
                          </div>
                          <span className={`matrix-badge ${enabled ? 'ok' : 'locked'}`}>
                            {enabled ? '已授權' : '未購買'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* License Key Updater */}
            <div className="license-update-card">
              <h3>更換 / 升級企業授權金鑰 (Update License Key)</h3>
              <p>請貼入系統管理員由金鑰產生器 (license-keygen) 發布的 HMAC-SHA256 授權金鑰字串：</p>

              <textarea
                rows={4}
                className="license-key-textarea"
                placeholder="請貼上以 BSLIC-V1- 開頭之授權金鑰..."
                value={newLicenseKey}
                onChange={(e) => setNewLicenseKey(e.target.value)}
              />

              {licenseMsg && (
                <div
                  className={`portal-alert ${
                    licenseMsg.ok ? 'portal-alert-success' : 'portal-alert-error'
                  }`}
                >
                  {licenseMsg.text}
                </div>
              )}

              <div className="license-key-actions">
                <button
                  type="button"
                  className="btn-apply-key"
                  disabled={busy || !newLicenseKey.trim()}
                  onClick={() => void handleUpdateLicense()}
                >
                  {busy ? '驗證中…' : '立即驗證並套用新金鑰'}
                </button>
              </div>

              {/* Quick Preset Buttons for Testing */}
              <div className="license-quick-presets">
                <span className="presets-title">快速測試金鑰載入 (1-Click Test Keys)：</span>
                <div className="presets-buttons">
                  <button
                    type="button"
                    className="btn-preset"
                    onClick={() => setNewLicenseKey(SAMPLE_KEYS.full)}
                  >
                    1. 載入全模組旗艦授權 (365天 / 6模組全開)
                  </button>
                  <button
                    type="button"
                    className="btn-preset"
                    onClick={() => setNewLicenseKey(SAMPLE_KEYS.partial)}
                  >
                    2. 載入部分模組授權 (180天 / 僅MES+ERP)
                  </button>
                  <button
                    type="button"
                    className="btn-preset warning"
                    onClick={() => setNewLicenseKey(SAMPLE_KEYS.expired)}
                  >
                    3. 載入過期授權 (測試資料鎖定)
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* =========================================================================
            TAB 5: 雲地資料同步 (HYBRID CLOUD-EDGE SYNC)
           ========================================================================= */}
        {activeTab === 'sync' && (
          <section className="portal-tab-pane portal-sync-pane">
            {/* Sync Hero Banner */}
            <div className="sync-hero-banner">
              <div className="sync-hero-content">
                <div className="sync-mode-tag">
                  <span className="sync-live-pulse" />
                  <span>雲地混合架構 (Hybrid Cloud-Edge Architecture) · 邊緣離線優先 & 雙向協同</span>
                </div>
                <h2>雲地即時資料同步與衝突仲裁中心</h2>
                <p>
                  地端門市 (POS) 與現場工廠 (MES) 具備離線自主權限，採用 UUIDv7 分散式唯一鍵與 Transactional Outbox 交易寄件匣模式。
                  即便遭遇實體網路斷線，現場作業 100% 照常運作；連線恢復後自動透過批次冪等去重與數值 Delta 增量完成雙向收斂，重大併發歧異自動進入衝突隔離審核台帳。
                </p>
              </div>
              <div className="sync-hero-stats">
                <div className="sync-stat-pill">
                  <span className="stat-num">{syncStatus?.pendingOutbox ?? 0}</span>
                  <span className="stat-label">待同步寄件匣</span>
                </div>
                <div className="sync-stat-pill success">
                  <span className="stat-num">{syncStatus?.syncedCount ?? 0}</span>
                  <span className="stat-label">累計已同步筆數</span>
                </div>
                <div className="sync-stat-pill danger">
                  <span className="stat-num">{syncStatus?.activeConflicts ?? 0}</span>
                  <span className="stat-label">隔離衝突待審核</span>
                </div>
              </div>
            </div>

            {/* Sync Metric Cards */}
            <div className="sync-metrics-grid">
              <div className="sync-metric-card">
                <div className="metric-header">
                  <span className="metric-icon">🌐</span>
                  <span className="metric-title">運作模式</span>
                </div>
                <div className="metric-value">離線自主 · 混合並行</div>
                <div className="metric-desc">現場邊緣節點離線運作，網路可用時階梯同步</div>
              </div>

              <div className="sync-metric-card">
                <div className="metric-header">
                  <span className="metric-icon">📤</span>
                  <span className="metric-title">本地寄件匣 (Outbox)</span>
                </div>
                <div className="metric-value highlight">{syncStatus?.pendingOutbox ?? 0} 筆</div>
                <div className="metric-desc">本地交易 ACID 原子寫入，保障異動零遺失</div>
              </div>

              <div className="sync-metric-card">
                <div className="metric-header">
                  <span className="metric-icon">📥</span>
                  <span className="metric-title">收件匣去重 (Inbox)</span>
                </div>
                <div className="metric-value success">{syncStatus?.syncedCount ?? 0} 筆</div>
                <div className="metric-desc">Idempotency Key 冪等去重，精確一次 (Exactly-Once)</div>
              </div>

              <div className="sync-metric-card">
                <div className="metric-header">
                  <span className="metric-icon">🛡️</span>
                  <span className="metric-title">衝突隔離區 (Quarantine)</span>
                </div>
                <div className={`metric-value ${(syncStatus?.activeConflicts ?? 0) > 0 ? 'danger' : 'safe'}`}>
                  {syncStatus?.activeConflicts ?? 0} 筆衝突
                </div>
                <div className="metric-desc">並發衝突安全隔離，絕不阻塞正常資料同步流水線</div>
              </div>
            </div>

            {/* Operations Control Bar */}
            <div className="sync-ops-card">
              <div className="ops-card-header">
                <div>
                  <h3>同步流水線控制與模擬測試</h3>
                  <p>手動觸發雙向推播與接收，或模擬雲端併發寫入以檢驗衝突隔離機制：</p>
                </div>
                <div className="ops-card-actions">
                  <button
                    type="button"
                    className="btn-sync-action primary"
                    disabled={busy}
                    onClick={() => void handleTriggerSync()}
                  >
                    {busy ? '同步處理中…' : '⚡ 立即執行雙向同步 (Push & Ack)'}
                  </button>
                  <button
                    type="button"
                    className="btn-sync-action secondary"
                    disabled={busy}
                    onClick={() => void handleSimulateConflict()}
                  >
                    {busy ? '模擬中…' : '🧪 模擬雲地併發衝突 (Simulate Conflict)'}
                  </button>
                  <button
                    type="button"
                    className="btn-sync-action ghost"
                    disabled={busy}
                    onClick={() => {
                      void loadSyncStatus();
                      void loadSyncConflicts();
                    }}
                  >
                    🔄 刷新即時狀態
                  </button>
                </div>
              </div>

              {syncMsg && (
                <div className={`portal-alert ${syncMsg.ok ? 'portal-alert-success' : 'portal-alert-error'}`}>
                  {syncMsg.text}
                </div>
              )}
            </div>

            {/* Quarantine Review Table */}
            <div className="sync-conflicts-card">
              <div className="conflicts-card-header">
                <h3>⚠️ 衝突隔離審核台帳 (Quarantined Conflict Records)</h3>
                <span className="conflicts-count-badge">
                  共 {syncConflicts.length} 筆待審核 / 隔離紀錄
                </span>
              </div>
              <p className="conflicts-desc">
                當雲端與地端發生不可自動合併的並發修改時，系統自動將遠端變更扣押於隔離區，保留完整現場與遠端版本資料以供稽核員或主管判定：
              </p>

              {syncConflicts.length === 0 ? (
                <div className="conflicts-empty-state">
                  <span className="empty-icon">✅</span>
                  <div>
                    <strong>目前無未解衝突事件</strong>
                    <p>所有雲地異動皆透過 Delta 增量合併或冪等去重順暢收斂，或點擊上方「模擬雲地併發衝突」進行驗證。</p>
                  </div>
                </div>
              ) : (
                <div className="conflicts-table-wrap">
                  <table className="conflicts-table">
                    <thead>
                      <tr>
                        <th>衝突 ID</th>
                        <th>所屬模組 / 實體</th>
                        <th>實體識別碼</th>
                        <th>衝突原因</th>
                        <th>隔離時間</th>
                        <th>狀態</th>
                        <th>版本對照 Payload</th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncConflicts.map((c) => (
                        <tr key={c.id}>
                          <td><code>{c.id}</code></td>
                          <td><span className="entity-tag">{c.entityType}</span></td>
                          <td><code>{c.entityId}</code></td>
                          <td className="conflict-reason-cell">{c.conflictReason}</td>
                          <td>{new Date(c.createdAt).toLocaleString()}</td>
                          <td>
                            <span className={`status-badge ${c.resolutionStatus}`}>
                              {c.resolutionStatus === 'quarantined' ? '⚠️ 已隔離扣押' : c.resolutionStatus}
                            </span>
                          </td>
                          <td className="payload-inspect-cell">
                            <details className="payload-dropdown">
                              <summary>檢視 Payload 對照</summary>
                              <div className="payload-compare-view">
                                <div className="payload-col">
                                  <h6>地端本地現有資料 (Local Payload)：</h6>
                                  <pre>{c.localPayload || '(未提供或本地無現存資料)'}</pre>
                                </div>
                                <div className="payload-col">
                                  <h6>雲端遠端傳入資料 (Remote Payload)：</h6>
                                  <pre>{c.remotePayload || '(無)'}</pre>
                                </div>
                              </div>
                            </details>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Architecture Highlights: 6 Pillars */}
            <div className="sync-architecture-section">
              <h3 className="section-title">🏛️ 雲地混合架構 6 大核心資料同步策略 (Hybrid Sync Architecture Pillars)</h3>
              <div className="sync-architecture-grid">
                <div className="sync-arch-card">
                  <div className="arch-num">01</div>
                  <h4>權威源領域劃分 (Authority Partitioning)</h4>
                  <p>
                    <strong>雲端權威：</strong> 組織主檔、產品型錄與標準價格表。<br />
                    <strong>地端權威：</strong> MES 工單報工進度、POS 現場結帳發票 (斷網亦具 100% 營業能力)。
                  </p>
                </div>

                <div className="sync-arch-card">
                  <div className="arch-num">02</div>
                  <h4>分散式時間唯一鍵 (UUIDv7 Primary Keys)</h4>
                  <p>
                    全域拋棄傳統 Auto-Increment 自增整數 ID，採用 UUIDv7 具備毫秒級時間戳排序與隨機熵，徹底根除離線新增資料上傳時的 ID 踩踏問題。
                  </p>
                </div>

                <div className="sync-arch-card">
                  <div className="arch-num">03</div>
                  <h4>交易式寄件匣 (Transactional Outbox)</h4>
                  <p>
                    所有業務異動（如工單狀態變更、銷貨單成立）與 Outbox 紀錄均在同一個本地 SQLite ACID Transaction 提交，杜絕雙寫不一致。
                  </p>
                </div>

                <div className="sync-arch-card">
                  <div className="arch-num">04</div>
                  <h4>冪等去重與精確一次 (Idempotency Ingestion)</h4>
                  <p>
                    每筆變更帶有唯一 <code>idempotency_key</code>。接收端 Inbox 自動攔截重複批次，面對不穩定弱網重傳時確保 Exactly-Once 處理語義。
                  </p>
                </div>

                <div className="sync-arch-card">
                  <div className="arch-num">05</div>
                  <h4>數值增量合併 (Delta-Merge) 與隔離暫存</h4>
                  <p>
                    庫存與流水餘額採用 <code>+Delta / -Delta</code> 相對增量合併，嚴禁粗暴覆寫 (LWW)。無法自動仲裁的並發衝突扣押至 Quarantine 表待審。
                  </p>
                </div>

                <div className="sync-arch-card">
                  <div className="arch-num">06</div>
                  <h4>斷線回壓與階梯重試 (Exponential Backoff)</h4>
                  <p>
                    網路故障時自動掛起並以指數退避演算法搭配隨機抖動 (Jitter) 重試；連線恢復後批次分頁推播，兼具零信任裝置權杖安全隔離。
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
