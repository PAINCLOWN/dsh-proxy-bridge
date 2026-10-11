/**
 * The proxy bridge configuration card for the DSH Plugins page.
 *
 * @module @riceawa/dsh-proxy-bridge/client/bridge-card
 */

import { useState, useCallback } from 'react'

interface BridgeCardProps {
  // The card reads/writes through the loopback /proxy-bridge/config route.
}

export function BridgeCard(_props: BridgeCardProps): React.JSX.Element {
  const [enabled, setEnabled] = useState(false)
  const [port, setPort] = useState(3083)
  const [dshPort, setDshPort] = useState(3080)
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const callBridge = useCallback(async (command: string, extra?: Record<string, unknown>) => {
    setBusy(true)
    try {
      const res = await fetch('/proxy-bridge/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command, ...extra }),
      })
      const data = await res.json()
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
    void callBridge('config', { port, dshPort, ...(password ? { password } : {}) })
  }, [callBridge, port, dshPort, password])

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h3 style={{ margin: '0 0 12px' }}>Proxy Bridge</h3>
      <p style={{ margin: '0 0 16px', color: '#666', fontSize: 13 }}>
        Lightweight reverse proxy for nginx → DSH. Relays HTTP + WebSocket without
        the same-site fence that breaks WS through nginx.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <label style={{ fontSize: 13 }}>
          <span>Bridge port</span>
          <input
            type="number"
            value={port}
            min={1}
            max={65535}
            onChange={(e) => setPort(Number(e.target.value))}
            style={{ width: '100%', marginTop: 4, padding: '4px 8px' }}
          />
        </label>
        <label style={{ fontSize: 13 }}>
          <span>DSH port</span>
          <input
            type="number"
            value={dshPort}
            min={1}
            max={65535}
            onChange={(e) => setDshPort(Number(e.target.value))}
            style={{ width: '100%', marginTop: 4, padding: '4px 8px' }}
          />
        </label>
      </div>

      <label style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
        <span>Password (optional, min 8 chars)</span>
        <input
          type="password"
          value={password}
          placeholder="Leave empty for no password"
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: '100%', marginTop: 4, padding: '4px 8px' }}
        />
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleEnable}
          disabled={busy || enabled}
          style={{ padding: '6px 16px', cursor: busy ? 'wait' : 'pointer' }}
        >
          Enable
        </button>
        <button
          onClick={handleDisable}
          disabled={busy || !enabled}
          style={{ padding: '6px 16px', cursor: busy ? 'wait' : 'pointer' }}
        >
          Disable
        </button>
        <button
          onClick={handleSave}
          disabled={busy}
          style={{ padding: '6px 16px', cursor: busy ? 'wait' : 'pointer' }}
        >
          Save Config
        </button>
      </div>

      {status && (
        <p style={{ marginTop: 12, fontSize: 12, color: status.startsWith('Error') ? '#c00' : '#080' }}>
          {status}
        </p>
      )}
    </div>
  )
}
