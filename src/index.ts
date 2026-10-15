/**
 * @painclown/dsh-proxy-bridge — a lightweight reverse-proxy bridge for the
 * DeepSeek Harness web GUI, designed to sit behind a TLS-terminating reverse
 * proxy (nginx).
 *
 * Solves the WebSocket Origin/Host mismatch that breaks WS connections through
 * nginx → gateway → DSH chains. Unlike the LAN gateway, it trusts the upstream
 * terminator and skips the strict same-site fence, so WS upgrades relay cleanly.
 *
 * The bridge:
 * - Binds to a configurable port (default 3083) on 0.0.0.0
 * - Forwards all HTTP requests to the loopback DSH server (default 3080)
 * - Relays WebSocket upgrades by splicing sockets to the upstream
 * - Rewrites Host/Origin to the loopback DSH port
 * - Optionally enforces a password gate (second layer on top of nginx)
 * - Auto-injects DSH auth cookies from the browser-session secret
 * - Supports self-signed TLS for direct HTTPS access
 * - Rate-limits login attempts and supports session revocation
 *
 * Disabled by default: the listener opens only after `proxy_bridge enable`
 * or `enabled: true` in settings.
 *
 * @module @painclown/dsh-proxy-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type SettingsService from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import {
  BridgeConfig,
  DEFAULT_COOKIE_MAX_AGE_DAYS,
  DEFAULT_COOKIE_NAME,
  DEFAULT_DSH_PORT,
  DEFAULT_PORT,
  DEFAULT_TLS_DAYS,
  MIN_PASSWORD_LENGTH,
  SETTINGS_NAMESPACE,
  type BridgeConfigValue,
} from './config-fields.ts'
import { ProxyBridge, type ProxyConfig } from './proxy.ts'
import {
  loadState,
  saveState,
  setPassword,
  type BridgeState,
} from './state.ts'
import { loadOrCreateSelfSigned } from './tls.ts'

/** Plugin identifier for the DSH bundle. */
export const name = 'dsh-proxy-bridge'

/** Services this plugin requires from the DSH runtime. */
export const inject = ['tools']

/** The bridge controller: owns the proxy lifecycle and config. */
interface BridgeController {
  bridge: ProxyBridge | null
  config: BridgeConfigValue
  state: BridgeState
  start: () => Promise<void>
  stop: () => Promise<void>
  restart: () => Promise<void>
  updateConfig: (partial: Partial<BridgeConfigValue>) => Promise<void>
  status: () => { running: boolean; port: number; dshPort: number; hasPassword: boolean; tls: boolean }
}

/**
 * Create the bridge controller that manages the proxy lifecycle.
 */
export function createController(ctx: Context): BridgeController {
  let bridge: ProxyBridge | null = null
  let config: BridgeConfigValue = {
    enabled: false,
    port: DEFAULT_PORT,
    dshPort: DEFAULT_DSH_PORT,
    password: '',
    cookieName: DEFAULT_COOKIE_NAME,
    cookieMaxAgeDays: DEFAULT_COOKIE_MAX_AGE_DAYS,
    dshSecret: '',
    secureCookies: false,
    tlsEnabled: false,
    tlsDays: DEFAULT_TLS_DAYS,
    tlsHosts: [],
    lanCidrs: [],
    lanPasswordless: false,
  }
  let state: BridgeState = loadState()
  let disposed = false

  // Read persisted config from settings if available.
  try {
    const settings = ctx.services.get(SettingsService) as SettingsService | undefined
    if (settings) {
      const stored = settings.get(SETTINGS_NAMESPACE) as Partial<BridgeConfigValue> | undefined
      if (stored) {
        config = { ...config, ...stored }
      }
    }
  } catch {
    // Settings not available yet; use defaults.
  }

  // Sync the state's password with the config (scrypt hash).
  async function syncStatePassword(): Promise<void> {
    const password = config.password || undefined
    state = await setPassword(state, password)
    saveState(state)
  }

  async function start(): Promise<void> {
    if (disposed) return
    if (bridge?.isRunning) return

    // Ensure the state's password matches the config.
    await syncStatePassword()

    // Load TLS material if enabled.
    let tls: ProxyConfig['tls']
    if (config.tlsEnabled) {
      const hosts = config.tlsHosts.length > 0 ? config.tlsHosts : ['localhost', '127.0.0.1']
      const { material, created } = loadOrCreateSelfSigned({
        hosts,
        days: config.tlsDays,
        commonName: hosts[0],
      })
      tls = material
      if (created) {
        ctx.log?.info?.(`[proxy-bridge] generated self-signed TLS certificate (CN=${hosts[0]})`)
      }
    }

    const proxyConfig: ProxyConfig = {
      port: config.port,
      dshPort: config.dshPort,
      password: config.password || undefined,
      cookieName: config.cookieName,
      cookieMaxAgeDays: config.cookieMaxAgeDays,
      dshSecret: config.dshSecret || undefined,
      secureCookies: config.secureCookies || config.tlsEnabled,
      tls,
      lanCidrs: config.lanCidrs,
      lanPasswordless: config.lanPasswordless,
      state,
      onStateChange: (newState: BridgeState) => {
        state = newState
        saveState(state)
      },
    }

    bridge = new ProxyBridge(proxyConfig)
    await bridge.listen()
    const proto = config.tlsEnabled ? 'https' : 'http'
    ctx.log?.info?.(`[proxy-bridge] listening on 0.0.0.0:${config.port} → 127.0.0.1:${config.dshPort} (${proto})`)
  }

  async function stop(): Promise<void> {
    if (bridge) {
      await bridge.close()
      bridge = null
      ctx.log?.info?.('[proxy-bridge] stopped')
    }
  }

  async function restart(): Promise<void> {
    await stop()
    if (config.enabled && !disposed) {
      await start()
    }
  }

  async function updateConfig(partial: Partial<BridgeConfigValue>): Promise<void> {
    const oldPort = config.port
    const oldDshPort = config.dshPort
    const oldEnabled = config.enabled
    const oldPassword = config.password
    const oldTlsEnabled = config.tlsEnabled
    const oldTlsDays = config.tlsDays
    const oldTlsHosts = config.tlsHosts
    config = { ...config, ...partial }

    // Persist to settings.
    try {
      const settings = ctx.services.get(SettingsService) as SettingsService | undefined
      settings?.set(SETTINGS_NAMESPACE, config)
    } catch {
      // Best effort.
    }

    // Sync state password if it changed.
    if (config.password !== oldPassword) {
      await syncStatePassword()
    }

    // Restart if the port, enabled state, or TLS config changed.
    if (
      config.port !== oldPort ||
      config.dshPort !== oldDshPort ||
      config.enabled !== oldEnabled ||
      config.tlsEnabled !== oldTlsEnabled ||
      config.tlsDays !== oldTlsDays ||
      JSON.stringify(config.tlsHosts) !== JSON.stringify(oldTlsHosts)
    ) {
      await restart()
    }
  }

  function status(): { running: boolean; port: number; dshPort: number; hasPassword: boolean; tls: boolean } {
    return {
      running: bridge?.isRunning ?? false,
      port: config.port,
      dshPort: config.dshPort,
      hasPassword: config.password.length > 0,
      tls: config.tlsEnabled,
    }
  }

  return { bridge, get config() { return config }, get state() { return state }, start, stop, restart, updateConfig, status }
}

/**
 * The DSH plugin entry point. Registers the proxy bridge tool and manages
 * the listener lifecycle.
 */
export default function proxyBridgePlugin(ctx: Context): void {
  const controller = createController(ctx)

  // The management tool: lets the agent (and the config card) control the bridge.
  const tool = {
    name: 'proxy_bridge',
    description:
      'Manage the DSH proxy bridge: a lightweight reverse proxy that sits behind nginx and relays HTTP + WebSocket to the DSH web server. Use to enable/disable, check status, or reconfigure the bridge.',
    schema: z.object({
      command: z.union([
        z.const('status'),
        z.const('enable'),
        z.const('disable'),
        z.const('restart'),
        z.const('config'),
      ]).default('status'),
      port: z.natural().min(1).max(65535).optional()
        .describe('Port to bind (enable/config only).'),
      dshPort: z.natural().min(1).max(65535).optional()
        .describe('Upstream DSH port (enable/config only).'),
      password: z.string().optional()
        .describe('Bridge password (config only; empty string clears).'),
      dshSecret: z.string().optional()
        .describe('DSH browser-session secret for auto-injecting DSH auth cookies (config only).'),
      secureCookies: z.boolean().optional()
        .describe('Add Secure flag to session cookies (config only).'),
      tlsEnabled: z.boolean().optional()
        .describe('Enable self-signed TLS / HTTPS listener (config only).'),
      tlsDays: z.natural().min(1).max(3650).optional()
        .describe('Self-signed certificate validity in days (config only).'),
      tlsHosts: z.array(z.string()).optional()
        .describe('Hosts for the self-signed certificate SAN (config only).'),
      lanCidrs: z.array(z.string()).optional()
        .describe('LAN CIDRs treated as trusted (config only).'),
      lanPasswordless: z.boolean().optional()
        .describe('Allow LAN/loopback sources to skip login (config only).'),
    }),
    async execute(input: z.infer<typeof tool.schema>) {
      const { command, port, dshPort, password, dshSecret, secureCookies, tlsEnabled, tlsDays, tlsHosts, lanCidrs, lanPasswordless } = input

      switch (command) {
        case 'status': {
          const s = controller.status()
          const proto = s.tls ? 'https' : 'http'
          return {
            ok: true,
            message: s.running
              ? `Bridge running on 0.0.0.0:${s.port} → 127.0.0.1:${s.dshPort} (${proto})${s.hasPassword ? ' (password protected)' : ''}`
              : `Bridge stopped (config: port=${s.port}, dshPort=${s.dshPort}, tls=${s.tls})`,
          }
        }
        case 'enable': {
          const updates: Partial<BridgeConfigValue> = { enabled: true }
          if (port !== undefined) updates.port = port
          if (dshPort !== undefined) updates.dshPort = dshPort
          await controller.updateConfig(updates)
          await controller.start()
          const s = controller.status()
          const proto = s.tls ? 'https' : 'http'
          return { ok: true, message: `Bridge enabled on 0.0.0.0:${s.port} → 127.0.0.1:${s.dshPort} (${proto})` }
        }
        case 'disable': {
          await controller.updateConfig({ enabled: false })
          await controller.stop()
          return { ok: true, message: 'Bridge disabled and stopped.' }
        }
        case 'restart': {
          await controller.restart()
          const s = controller.status()
          return { ok: true, message: s.running ? `Bridge restarted on port ${s.port}.` : 'Bridge is stopped.' }
        }
        case 'config': {
          const updates: Partial<BridgeConfigValue> = {}
          if (port !== undefined) updates.port = port
          if (dshPort !== undefined) updates.dshPort = dshPort
          if (password !== undefined) {
            if (password.length > 0 && password.length < MIN_PASSWORD_LENGTH) {
              return { ok: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }
            }
            updates.password = password
          }
          if (dshSecret !== undefined) updates.dshSecret = dshSecret
          if (secureCookies !== undefined) updates.secureCookies = secureCookies
          if (tlsEnabled !== undefined) updates.tlsEnabled = tlsEnabled
          if (tlsDays !== undefined) updates.tlsDays = tlsDays
          if (tlsHosts !== undefined) updates.tlsHosts = tlsHosts
          if (lanCidrs !== undefined) updates.lanCidrs = lanCidrs
          if (lanPasswordless !== undefined) updates.lanPasswordless = lanPasswordless
          await controller.updateConfig(updates)
          const s = controller.status()
          const proto = s.tls ? 'https' : 'http'
          return { ok: true, message: `Config updated. Bridge ${s.running ? 'running' : 'stopped'} on port ${s.port} (${proto}).` }
        }
      }
    },
  }

  ctx.tools.register(tool as any)

  // Sync the bridge with the config on boot.
  ctx.effect(() => {
    if (controller.config.enabled) {
      void controller.start()
    }
    return async () => {
      await controller.stop()
    }
  }, 'dsh-proxy-bridge: listener lifecycle')
}
