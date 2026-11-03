/**
 * The proxy bridge configuration card for the DSH Plugins page.
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
}

/* ── Component ─────────────────────────────────────────────────────── */

export function BridgeCard(_props: Record<string, never>): React.JSX.Element {
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
      setStatus(data.message ?? (data.ok ? 'OK' : 'Failed'))
    } catch (err) {
      setStatus(`Error: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }, [])

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
      {bridgeStatus.running ? 'Running' : 'Stopped'}
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
              <h3 style={S.title}>Proxy Bridge</h3>
              {statusBadge}
            </div>
          </div>
        </div>
        <p style={S.subtitle}>
          Lightweight reverse proxy for nginx → DSH. Relays HTTP + WebSocket
          without the same-site fence that breaks WS through nginx.
        </p>
      </div>

      {/* Body */}
      <div style={S.body}>
        {/* Basic */}
        <div style={S.section}>
          <div style={S.sectionHeader}>
            <div style={S.sectionIcon}>⚙</div>
            <span style={S.sectionTitle}>Basic</span>
          </div>
          <div style={S.sectionBody}>
            <div style={S.fieldRow}>
              <div style={S.field}>
                <label style={S.label}>Bridge port</label>
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
                <label style={S.label}>DSH port</label>
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
              <label style={S.label}>Password (optional, min 8 chars)</label>
              <input
                type="password"
                value={password}
                placeholder="Leave empty for no password"
                onChange={(e) => setPassword(inputValue(e))}
                style={S.input}
              />
            </div>
            <div style={S.field}>
              <label style={S.label}>DSH secret (auto-inject auth cookies)</label>
              <input
                type="password"
                value={dshSecret}
                placeholder="Base64url DSH browser-session secret"
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
            <span style={S.sectionTitle}>TLS</span>
          </div>
          <div style={S.sectionBody}>
            <label style={S.checkbox}>
              <input
                type="checkbox"
                checked={tlsEnabled}
                onChange={(e) => setTlsEnabled(checkedValue(e))}
                style={S.checkboxInput}
              />
              Enable self-signed TLS
            </label>
            {tlsEnabled && (
              <>
                <div style={S.field}>
                  <label style={S.label}>SAN hosts (comma-separated)</label>
                  <input
                    type="text"
                    value={tlsHosts}
                    placeholder="dsh.example.com, 192.168.1.100"
                    onChange={(e) => setTlsHosts(inputValue(e))}
                    style={S.input}
                  />
                </div>
                <div style={S.field}>
                  <label style={S.label}>Cert validity (days)</label>
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
            <span style={S.sectionTitle}>LAN</span>
          </div>
          <div style={S.sectionBody}>
            <div style={S.field}>
              <label style={S.label}>LAN CIDRs (comma-separated)</label>
              <input
                type="text"
                value={lanCidrs}
                placeholder="192.168.0.0/16, 10.0.0.0/8"
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
              LAN passwordless (skip login for LAN / loopback)
            </label>
          </div>
        </div>

        {/* WS */}
        <div style={S.section}>
          <div style={S.sectionHeader}>
            <div style={{ ...S.sectionIcon, background: C.dangerSoft, color: C.danger }}>⚡</div>
            <span style={S.sectionTitle}>WebSocket</span>
          </div>
          <div style={S.sectionBody}>
            <div style={S.field}>
              <label style={S.label}>WS path whitelist (comma-separated; empty = allow all)</label>
              <input
                type="text"
                value={wsPaths}
                placeholder="/api/remote.mux"
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
          {enabled ? '✓ Enabled' : 'Enable'}
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
          Disable
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
          {busy ? 'Saving…' : 'Save Config'}
        </button>
      </div>

      {/* Status */}
      {status && (
        <div
          style={{
            ...S.status,
            color: status.startsWith('Error') ? C.danger : C.success,
            background: status.startsWith('Error') ? C.dangerSoft : C.successSoft,
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
