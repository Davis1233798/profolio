import React, { useState, useEffect } from 'react';
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

const stationModules = [
  {
    key: 'mes',
    name: 'ForgeFlow MES',
    zhName: '智能製造執行系統',
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

export function PortalDashboard({
  identity,
  onIdentityChange,
}: {
  identity: Identity | null;
  onIdentityChange: () => Promise<void>;
}) {
  const [licenseInfo, setLicenseInfo] = useState<LicenseStatusResponse | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showLicenseModal, setShowLicenseModal] = useState(false);
  const [newLicenseKey, setNewLicenseKey] = useState('');
  const [licenseMsg, setLicenseMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [busy, setBusy] = useState(false);

  // Load license status
  const loadLicense = async () => {
    try {
      const res = await fetch('/api/license/status', { credentials: 'same-origin' });
      const json = await res.json();
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
      const res = await fetch('/api/audit/logs?limit=50', { credentials: 'same-origin' });
      const json = await res.json();
      if (json.success && json.data?.logs) {
        setAuditLogs(json.data.logs);
      }
    } catch (e) {
      console.error('Failed to load audit logs', e);
    }
  };

  useEffect(() => {
    void loadLicense();
  }, []);

  useEffect(() => {
    if (showAuditModal) {
      void loadAuditLogs();
    }
  }, [showAuditModal]);

  // SSO Login action
  const handleSSOLogin = async (email: string, pass: string) => {
    setBusy(true);
    setLoginError('');
    try {
      const res = await fetch('/api/auth/sso-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password: pass }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || '登入失敗，請確認帳號與密碼');
      }
      await onIdentityChange();
      await loadLicense();
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
      const data = await res.json();
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
                className="btn-portal-ghost"
                onClick={() => setShowAuditModal(true)}
                title="查看系統操作與存取稽核軌跡"
              >
                📋 稽核軌跡
              </button>
              <button
                type="button"
                className="btn-portal-ghost"
                onClick={() => setShowLicenseModal(true)}
                title="管理企業授權金鑰與方案模組"
              >
                🔑 授權金鑰
              </button>
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
                onClick={() => setShowLicenseModal(true)}
              >
                🔑 授權資訊
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="portal-content-wrap">
        {/* License Hero Card */}
        {licenseInfo && (
          <section className="portal-license-banner">
            <div className="license-banner-left">
              <div className="license-tag-row">
                <span className="license-tag-corp">🏢 {licenseInfo.license.customer}</span>
                <span className="license-tag-tier">
                  💎 {licenseInfo.license.tier.toUpperCase()}
                </span>
                <span className={`license-status-badge ${licenseInfo.isExpired ? 'expired' : 'active'}`}>
                  {licenseInfo.isExpired ? '🔴 授權已到期 (LOCKED)' : '🟢 授權正常啟用中 (ACTIVE)'}
                </span>
              </div>
              <h1 className="portal-hero-title">企業全方位業務子系統整合中心</h1>
              <p className="portal-hero-desc">
                登入一次 (SSO)，即刻獲得授權子系統無縫存取權限。全流程操作均受企業級安全稽核審查保護。
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
                  onClick={() => setShowLicenseModal(true)}
                >
                  更換 / 升級金鑰
                </button>
              </div>
            </div>
          </section>
        )}

        {/* When NOT logged in: Show Modern SSO Selection */}
        {!identity && (
          <section className="portal-sso-login-section">
            <div className="sso-section-header">
              <h2>⚡ 選擇操作角色 快速進行 SSO 統一身分登入</h2>
              <p>無須於各子系統反覆輸入密碼。點選角色直接登入，系統將自動寫入登入稽核紀錄並同步授權會話。</p>
            </div>

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
                    <button
                      type="button"
                      className="btn-sso-enter"
                      disabled={busy}
                    >
                      {busy ? '登入中…' : '一鍵 SSO 登入 →'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="sso-manual-box">
              <h3>或使用特定帳號登入 (Custom Account Sign-In)</h3>
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

        {/* When Logged in: Show Purchased Subsystem Matrix */}
        {identity && (
          <section className="portal-modules-section">
            <div className="modules-section-header">
              <div>
                <h2>🚀 已授權子系統 (Enterprise Subsystem Suite)</h2>
                <p>
                  當前操作身分：<strong>{identity.name}</strong> ({identity.email})。點擊進入子系統，會話將無縫連通，無須再輸入帳號密碼。
                </p>
              </div>
              <div className="license-modules-summary">
                已授權模組：
                {licenseInfo?.license.modules.map((m) => (
                  <span key={m} className="mod-pill">
                    {m.toUpperCase()}
                  </span>
                ))}
              </div>
            </div>

            <div className="modules-grid">
              {stationModules.map((mod) => {
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
                        <a href={mod.entryUrl} className="btn-module-launch">
                          立即進入 {mod.name} →
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="btn-module-locked"
                          onClick={() => setShowLicenseModal(true)}
                        >
                          🔒 方案未包含 (請升級授權金鑰)
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Audit Trail Modal */}
        {showAuditModal && (
          <div className="portal-modal-backdrop" onClick={() => setShowAuditModal(false)}>
            <div className="portal-modal-card large" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <h3>📋 企業登入與操作安全稽核軌跡 (Audit Trail)</h3>
                  <p>完整紀錄 SSO 登入、模組存取、授權異動與安全攔截事件。</p>
                </div>
                <div className="modal-header-actions">
                  <button type="button" className="btn-refresh" onClick={() => void loadAuditLogs()}>
                    🔄 重新整理
                  </button>
                  <button type="button" className="btn-close" onClick={() => setShowAuditModal(false)}>
                    ✕
                  </button>
                </div>
              </div>

              <div className="modal-body-scroll">
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
                    {auditLogs.map((log) => (
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
                    {auditLogs.length === 0 && (
                      <tr>
                        <td colSpan={7} className="empty-audit">
                          目前尚無稽核日誌紀錄
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* License Manager Modal */}
        {showLicenseModal && (
          <div className="portal-modal-backdrop" onClick={() => setShowLicenseModal(false)}>
            <div className="portal-modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <h3>🔑 企業授權金鑰管理 (License Manager)</h3>
                  <p>驗證企業授權有效性、檢視可用模組與套用新金鑰。</p>
                </div>
                <button type="button" className="btn-close" onClick={() => setShowLicenseModal(false)}>
                  ✕
                </button>
              </div>

              <div className="modal-body">
                {licenseInfo && (
                  <div className="license-info-card">
                    <div className="info-row">
                      <span>授權編號 (ID)：</span>
                      <code>{licenseInfo.license.id}</code>
                    </div>
                    <div className="info-row">
                      <span>客戶名稱 (Customer)：</span>
                      <strong>{licenseInfo.license.customer}</strong>
                    </div>
                    <div className="info-row">
                      <span>授權等級 (Tier)：</span>
                      <strong>{licenseInfo.license.tier}</strong>
                    </div>
                    <div className="info-row">
                      <span>已購模組 (Modules)：</span>
                      <div>
                        {licenseInfo.license.modules.map((m) => (
                          <span key={m} className="mod-pill">
                            {m.toUpperCase()}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="info-row">
                      <span>到期日期 (Expires)：</span>
                      <span>
                        {licenseInfo.expiresAtFormatted} (剩餘 {licenseInfo.remainingDays} 天)
                      </span>
                    </div>
                  </div>
                )}

                <div className="license-update-box">
                  <label>
                    <strong>輸入或貼上新的授權金鑰 (License Key)：</strong>
                    <textarea
                      rows={3}
                      placeholder="請貼上以 BSLIC-V1- 開頭的 HMAC-SHA256 簽署金鑰字串..."
                      value={newLicenseKey}
                      onChange={(e) => setNewLicenseKey(e.target.value)}
                    />
                  </label>

                  {licenseMsg && (
                    <div
                      className={`portal-alert ${
                        licenseMsg.ok ? 'portal-alert-success' : 'portal-alert-error'
                      }`}
                    >
                      {licenseMsg.text}
                    </div>
                  )}

                  <div className="license-actions-row">
                    <button
                      type="button"
                      className="btn-apply-key"
                      disabled={busy || !newLicenseKey.trim()}
                      onClick={() => void handleUpdateLicense()}
                    >
                      {busy ? '驗證中…' : '立即驗證並套用金鑰'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
