/**
 * The proxy bridge configuration card for the DSH Plugins page.
 * Supports Chinese / English bilingual switching.
 *
 * @module @painclown/dsh-proxy-bridge/client/bridge-card
 */

import { useState, useCallback, useEffect } from 'react'

interface BridgeStatus {
  running: boolean
  port: number
  dshPort: number
  hasPassword: boolean
  tls: boolean
}

type Lang = 'zh' | 'en'

/* ── i18n ──────────────────────────────────────────────────────────── */

const T: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Proxy Bridge',
    subtitle: 'Lightweight reverse proxy for nginx → DSH. Relays HTTP + WebSocket without the same-site fence that breaks WS through nginx.',
    basic: 'Basic',
    bridgePort: 'Bridge port',
    dshPort: 'DSH port',
    password: 'Password (optional, min 8 chars)',
    passwordPlaceholder: 'Leave empty for no password',
    dshSecret: 'DSH secret (auto-inject auth cookies)',
    dshSecretPlaceholder: 'Base64url DSH browser-session secret',
    tls: 'TLS',
    enableTls: 'Enable self-signed TLS',
    sanHosts: 'SAN hosts (comma-separated)',
    sanHostsPlaceholder: 'dsh.example.com, 192.168.1.100',
    certValidity: 'Cert validity (days)',
    lan: 'LAN',
    lanCidrs: 'LAN CIDRs (comma-separated)',
    lanCidrsPlaceholder: '192.168.0.0/16, 10.0.0.0/8',
    lanPasswordless: 'LAN passwordless (skip login for LAN / loopback)',
    websocket: 'WebSocket',
    wsPaths: 'WS path whitelist (comma-separated; empty = allow all)',
    wsPathsPlaceholder: '/api/remote.mux',
    enable: 'Enable',
    enabled: '✓ Enabled',
    disable: 'Disable',
    saveConfig: 'Save Config',
    saving: 'Saving…',
    running: 'Running',
    stopped: 'Stopped',
    ok: 'OK',
    failed: 'Failed',
    error: 'Error',
  },
  zh: {
    title: '代理桥',
    subtitle: '轻量级反向代理，用于 nginx → DSH。中继 HTTP + WebSocket，避免 nginx 同源策略导致的 WS 中断。',
    basic: '基础配置',
    bridgePort: '桥端口',
    dshPort: 'DSH 端口',
    password: '密码（可选，至少 8 位）',
    passwordPlaceholder: '留空则不设密码',
    dshSecret: 'DSH 密钥（自动注入认证 Cookie）',
    dshSecretPlaceholder: 'Base64url 编码的 DSH 浏览器会话密钥',
    tls: 'TLS',
    enableTls: '启用自签名 TLS',
    sanHosts: 'SAN 主机（逗号分隔）',
    sanHostsPlaceholder: 'dsh.example.com, 192.168.1.100',
    certValidity: '证书有效期（天）',
    lan: '局域网',
    lanCidrs: '局域网 CIDR（逗号分隔）',
    lanCidrsPlaceholder: '192.168.0.0/16, 10.0.0.0/8',
    lanPasswordless: '局域网免密（LAN / 回环地址跳过登录）',
    websocket: 'WebSocket',
    wsPaths: 'WS 路径白名单（逗号分隔；留空 = 允许全部）',
    wsPathsPlaceholder: '/api/remote.mux',
    enable: '启用',
    enabled: '✓ 已启用',
    disable: '停用',
    saveConfig: '保存配置',
    saving: '保存中…',
    running: '运行中',
    stopped: '已停止',
    ok: '成功',
    failed: '失败',
    error: '错误',
  },
}

function inputValue(e: React.FormEvent<HTMLInputElement>): string {
  return (e.target as HTMLInputElement).value
}

function checkedValue(e: React.FormEvent<HTMLInputElement>): boolean {
  return (e.target as HTMLInputElement).checked
}

/* ── Design tokens ─────────────────────────────────────────────────── */

const C = {
  bg: 'var(--dsw-alias-bg-layer-2, #131a28)',
  bgSection: 'var(--dsw-alias-bg-layer-1, #0f1520)',
  bgInput: 'var(--dsw-alias-bg-layer-3, #182030)',
  border: 'var(--dsw-alias-border-l2, #253040)',
  borderFocus: 'var(--dsw-alias-brand-primary, #3b82f6)',
  text: 'var(--dsw-alias-label-primary, #e2e8f0)',
  textDim: 'var(--dsw-alias-label-secondary, #94a3b8)',
  textFaint: 'var(--dsw-alias-label-tertiary, #64748b)',
  accent: 'var(--dsw-alias-brand-primary, #3b82f6)',
  accentSoft: 'var(--dsw-alias-brand-primary, #3b82f6)18',
  success: 'var(--dsw-alias-state-success-primary, #22c55e)',
  successSoft: 'var(--dsw-alias-state-success-primary, #22c55e)18',
  danger: 'var(--dsw-alias-state-error-primary, #ef4444)',
  dangerSoft: 'var(--dsw-alias-state-error-primary, #ef4444)18',
  warn: 'var(--dsw-alias-state-warn-primary, #f59e0b)',
  warnSoft: 'var(--dsw-alias-state-warn-primary, #f59e0b)18',
}

/* ── Styles ────────────────────────────────────────────────────────── */

const S = {
  card: {
    padding: 0,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    background: C.bg,
    borderRadius: 12,
    border: `1px solid ${C.border}`,
    overflow: 'hidden',
  } as React.CSSProperties,

  header: {
    padding: '20px 24px',
    background: `linear-gradient(135deg, ${C.accentSoft}, transparent 60%)`,
    borderBottom: `1px solid ${C.border}`,
  } as React.CSSProperties,

  headerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  } as React.CSSProperties,

  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: C.text,
    letterSpacing: '-0.02em',
  } as React.CSSProperties,

  subtitle: {
    margin: '6px 0 0',
    fontSize: 13,
    color: C.textDim,
    lineHeight: 1.5,
  } as React.CSSProperties,

  body: {
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  } as React.CSSProperties,

  section: {
    background: C.bgSection,
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    overflow: 'hidden',
  } as React.CSSProperties,

  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    borderBottom: `1px solid ${C.border}`,
    background: `${C.accent}08`,
  } as React.CSSProperties,

  sectionIcon: {
    fontSize: 14,
    width: 24,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    background: C.accentSoft,
    color: C.accent,
  } as React.CSSProperties,

  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: C.text,
    letterSpacing: '0.01em',
  } as React.CSSProperties,

  sectionBody: {
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  } as React.CSSProperties,

  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  } as React.CSSProperties,

  fieldRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
  } as React.CSSProperties,

  label: {
    fontSize: 12,
    fontWeight: 500,
    color: C.textDim,
  } as React.CSSProperties,

  input: {
    width: '100%',
    padding: '8px 12px',
    fontSize: 13,
    color: C.text,
    background: C.bgInput,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  } as React.CSSProperties,

  checkbox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: C.text,
    cursor: 'pointer',
  } as React.CSSProperties,

  checkboxInput: {
    width: 16,
    height: 16,
    accentColor: C.accent,
    cursor: 'pointer',
  } as React.CSSProperties,

  actions: {
    display: 'flex',
    gap: 8,
    padding: '16px 24px',
    borderTop: `1px solid ${C.border}`,
    background: C.bgSection,
  } as React.CSSProperties,

  btn: {
    padding: '8px 20px',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    transition: 'opacity 0.2s, transform 0.1s',
    letterSpacing: '0.01em',
  } as React.CSSProperties,

  status: {
    padding: '10px 24px',
    fontSize: 12,
    fontFamily: 'ui-monospace, monospace',
    borderTop: `1px solid ${C.border}`,
  } as React.CSSProperties,

  langToggle: {
    display: 'flex',
    gap: 0,
    borderRadius: 6,
    overflow: 'hidden',
    border: `1px solid ${C.border}`,
  } as React.CSSProperties,

  langBtn: (active: boolean): React.CSSProperties => ({
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
    transition: 'background 0.2s, color 0.2s',
    background: active ? C.accent : 'transparent',
    color: active ? '#fff' : C.textDim,
  }),
}

/* ── Component ─────────────────────────────────────────────────────── */

export function BridgeCard(_props: Record<string, never>): React.JSX.Element {
  const [lang, setLang] = useState<Lang>(() => {
    try { return (localStorage.getItem('dsh-bridge-lang') as Lang) || 'zh' } catch { return 'zh' }
  })
  const [enabled, setEnabled] = useState(false)
  const [port, setPort] = useState(3083)
  const [dshPort, setDshPort] = useState(3080)
  const [password, setPassword] = useState('')
  const [dshSecret, setDshSecret] = useState('')
  const [tlsEnabled, setTlsEnabled] = useState(false)
  const [tlsHosts, setTlsHosts] = useState('')
  const [tlsDays, setTlsDays] = useState(365)
  const [lanCidrs, setLanCidrs] = useState('')
  const [lanPasswordless, setLanPasswordless] = useState(false)
  const [wsPaths, setWsPaths] = useState('/api/remote.mux')
  const [status, setStatus] = useState<string>('')
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const t = T[lang]

  const switchLang = useCallback((l: Lang) => {
    setLang(l)
    try { localStorage.setItem('dsh-bridge-lang', l) } catch { /* noop */ }
  }, [])

  // Poll bridge status every 5 s.
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/proxy-bridge/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ command: 'status' }),
        })
        const data = await res.json() as { ok: boolean; message: string }
        if (data.ok) {
          setBridgeStatus({
            running: data.message.includes('running'),
            port: 3083,
            dshPort: 3080,
            hasPassword: data.message.includes('password'),
            tls: data.message.includes('https'),
          })
        }
      } catch { /* bridge not reachable */ }
    }, 5000)
    return () => clearInterval(timer)
  }, [])

  const callBridge = useCallback(async (command: string, extra?: Record<string, unknown>) => {
    setBusy(true)
    try {
      const res = await fetch('/proxy-bridge/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command, ...extra }),
      })
      const data = await res.json() as { ok: boolean; message: string }
      setStatus(data.message ?? (data.ok ? t.ok : t.failed))
    } catch (err) {
      setStatus(`${t.error}: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }, [t])

  const handleEnable = useCallback(() => {
    setEnabled(true)
    void callBridge('enable', { port, dshPort })
  }, [callBridge, port, dshPort])

  const handleDisable = useCallback(() => {
    setEnabled(false)
    void callBridge('disable')
  }, [callBridge])

  const handleSave = useCallback(() => {
    const updates: Record<string, unknown> = { port, dshPort }
    if (password) updates.password = password
    if (dshSecret) updates.dshSecret = dshSecret
    updates.tlsEnabled = tlsEnabled
    if (tlsHosts) updates.tlsHosts = tlsHosts.split(',').map((s) => s.trim()).filter(Boolean)
    updates.tlsDays = tlsDays
    if (lanCidrs) updates.lanCidrs = lanCidrs.split(',').map((s) => s.trim()).filter(Boolean)
    updates.lanPasswordless = lanPasswordless
    updates.wsPaths = wsPaths.split(',').map((s) => s.trim()).filter(Boolean)
    void callBridge('config', updates)
  }, [callBridge, port, dshPort, password, dshSecret, tlsEnabled, tlsHosts, tlsDays, lanCidrs, lanPasswordless, wsPaths])

  /* ── Status badge ────────────────────────────────────────────── */

  const statusBadge = bridgeStatus && (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '3px 10px',
        borderRadius: 20,
        background: bridgeStatus.running ? C.successSoft : `${C.textFaint}18`,
        color: bridgeStatus.running ? C.success : C.textFaint,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        letterSpacing: '0.02em',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: bridgeStatus.running ? C.success : C.textFaint,
          animation: bridgeStatus.running ? 'pulse 2s infinite' : 'none',
        }}
      />
      {bridgeStatus.running ? t.running : t.stopped}
    </span>
  )

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div style={S.card}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.headerRow}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: `linear-gradient(135deg, ${C.accent}, ${C.accent}88)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              color: '#fff',
              fontWeight: 700,
            }}
          >
            ⇌
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h3 style={S.title}>{t.title}</h3>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: C.accentSoft,
                  color: C.accent,
                  fontFamily: 'ui-monospace, monospace',
                  letterSpacing: '0.03em',
                }}
              >
                v2.0
              </span>
              {statusBadge}
            </div>
          </div>
          {/* Language toggle */}
          <div style={S.langToggle}>
            <button
              onClick={() => switchLang('zh')}
              style={S.langBtn(lang === 'zh')}
              title="中文"
            >
              中
            </button>
            <button
              onClick={() => switchLang('en')}
              style={S.langBtn(lang === 'en')}
              title="English"
            >
              EN
            </button>
          </div>
        </div>
        <p style={S.subtitle}>{t.subtitle}</p>
      </div>

      {/* Body */}
      <div style={S.body}>
        {/* Basic */}
        <div style={S.section}>
          <div style={S.sectionHeader}>
            <div style={S.sectionIcon}>⚙</div>
            <span style={S.sectionTitle}>{t.basic}</span>
          </div>
          <div style={S.sectionBody}>
            <div style={S.fieldRow}>
              <div style={S.field}>
                <label style={S.label}>{t.bridgePort}</label>
                <input
                  type="number"
                  value={port}
                  min={1}
                  max={65535}
                  onChange={(e) => setPort(Number(inputValue(e)))}
                  style={S.input}
                />
              </div>
              <div style={S.field}>
                <label style={S.label}>{t.dshPort}</label>
                <input
                  type="number"
                  value={dshPort}
                  min={1}
                  max={65535}
                  onChange={(e) => setDshPort(Number(inputValue(e)))}
                  style={S.input}
                />
              </div>
            </div>
            <div style={S.field}>
              <label style={S.label}>{t.password}</label>
              <input
                type="password"
                value={password}
                placeholder={t.passwordPlaceholder}
                onChange={(e) => setPassword(inputValue(e))}
                style={S.input}
              />
            </div>
            <div style={S.field}>
              <label style={S.label}>{t.dshSecret}</label>
              <input
                type="password"
                value={dshSecret}
                placeholder={t.dshSecretPlaceholder}
                onChange={(e) => setDshSecret(inputValue(e))}
                style={S.input}
              />
            </div>
          </div>
        </div>

        {/* TLS */}
        <div style={S.section}>
          <div style={S.sectionHeader}>
            <div style={{ ...S.sectionIcon, background: C.warnSoft, color: C.warn }}>🔒</div>
            <span style={S.sectionTitle}>{t.tls}</span>
          </div>
          <div style={S.sectionBody}>
            <label style={S.checkbox}>
              <input
                type="checkbox"
                checked={tlsEnabled}
                onChange={(e) => setTlsEnabled(checkedValue(e))}
                style={S.checkboxInput}
              />
              {t.enableTls}
            </label>
            {tlsEnabled && (
              <>
                <div style={S.field}>
                  <label style={S.label}>{t.sanHosts}</label>
                  <input
                    type="text"
                    value={tlsHosts}
                    placeholder={t.sanHostsPlaceholder}
                    onChange={(e) => setTlsHosts(inputValue(e))}
                    style={S.input}
                  />
                </div>
                <div style={S.field}>
                  <label style={S.label}>{t.certValidity}</label>
                  <input
                    type="number"
                    value={tlsDays}
                    min={1}
                    max={3650}
                    onChange={(e) => setTlsDays(Number(inputValue(e)))}
                    style={S.input}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* LAN */}
        <div style={S.section}>
          <div style={S.sectionHeader}>
            <div style={{ ...S.sectionIcon, background: C.successSoft, color: C.success }}>📡</div>
            <span style={S.sectionTitle}>{t.lan}</span>
          </div>
          <div style={S.sectionBody}>
            <div style={S.field}>
              <label style={S.label}>{t.lanCidrs}</label>
              <input
                type="text"
                value={lanCidrs}
                placeholder={t.lanCidrsPlaceholder}
                onChange={(e) => setLanCidrs(inputValue(e))}
                style={S.input}
              />
            </div>
            <label style={S.checkbox}>
              <input
                type="checkbox"
                checked={lanPasswordless}
                onChange={(e) => setLanPasswordless(checkedValue(e))}
                style={S.checkboxInput}
              />
              {t.lanPasswordless}
            </label>
          </div>
        </div>

        {/* WS */}
        <div style={S.section}>
          <div style={S.sectionHeader}>
            <div style={{ ...S.sectionIcon, background: C.dangerSoft, color: C.danger }}>⚡</div>
            <span style={S.sectionTitle}>{t.websocket}</span>
          </div>
          <div style={S.sectionBody}>
            <div style={S.field}>
              <label style={S.label}>{t.wsPaths}</label>
              <input
                type="text"
                value={wsPaths}
                placeholder={t.wsPathsPlaceholder}
                onChange={(e) => setWsPaths(inputValue(e))}
                style={S.input}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={S.actions}>
        <button
          onClick={handleEnable}
          disabled={busy || enabled}
          style={{
            ...S.btn,
            background: enabled ? `${C.textFaint}18` : `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
            color: enabled ? C.textFaint : '#fff',
            cursor: busy ? 'wait' : enabled ? 'default' : 'pointer',
            opacity: busy ? 0.7 : 1,
          }}
        >
          {enabled ? t.enabled : t.enable}
        </button>
        <button
          onClick={handleDisable}
          disabled={busy || !enabled}
          style={{
            ...S.btn,
            background: C.dangerSoft,
            color: C.danger,
            cursor: busy ? 'wait' : enabled ? 'pointer' : 'default',
            opacity: busy || !enabled ? 0.5 : 1,
          }}
        >
          {t.disable}
        </button>
        <button
          onClick={handleSave}
          disabled={busy}
          style={{
            ...S.btn,
            background: C.bgInput,
            color: C.text,
            border: `1px solid ${C.border}`,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.7 : 1,
            marginLeft: 'auto',
          }}
        >
          {busy ? t.saving : t.saveConfig}
        </button>
      </div>

      {/* Status */}
      {status && (
        <div
          style={{
            ...S.status,
            color: status.startsWith(t.error) ? C.danger : C.success,
            background: status.startsWith(t.error) ? C.dangerSoft : C.successSoft,
          }}
        >
          {status}
        </div>
      )}

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        input:focus {
          border-color: ${C.borderFocus} !important;
          box-shadow: 0 0 0 3px ${C.accent}20 !important;
        }
        input::placeholder {
          color: ${C.textFaint};
        }
      `}</style>
    </div>
  )
}
