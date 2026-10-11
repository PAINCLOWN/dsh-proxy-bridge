/**
 * @riceawa/dsh-proxy-bridge — a lightweight reverse-proxy bridge for the
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
 *
 * Disabled by default: the listener opens only after `proxy_bridge enable`
 * or `enabled: true` in settings.
 *
 * @module @riceawa/dsh-proxy-bridge
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
  MIN_PASSWORD_LENGTH,
  SETTINGS_NAMESPACE,
  type BridgeConfigValue,
} from './config-fields.ts'
import { ProxyBridge, type ProxyConfig } from './proxy.ts'

/** The bridge controller: owns the proxy lifecycle and config. */
interface BridgeController {
  bridge: ProxyBridge | null
  config: BridgeConfigValue
  start: () => Promise<void>
  stop: () => Promise<void>
  restart: () => Promise<void>
  updateConfig: (partial: Partial<BridgeConfigValue>) => void
  status: () => { running: boolean; port: number; dshPort: number; hasPassword: boolean }
}

/**
 * Create the bridge controller that manages the proxy lifecycle.
 */
function createController(ctx: Context): BridgeController {
  let bridge: ProxyBridge | null = null
  let config: BridgeConfigValue = {
    enabled: false,
    port: DEFAULT_PORT,
    dshPort: DEFAULT_DSH_PORT,
    password: '',
    cookieName: DEFAULT_COOKIE_NAME,
    cookieMaxAgeDays: DEFAULT_COOKIE_MAX_AGE_DAYS,
  }
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

  async function start(): Promise<void> {
    if (disposed) return
    if (bridge?.isRunning) return

    const proxyConfig: ProxyConfig = {
      port: config.port,
      dshPort: config.dshPort,
      password: config.password || undefined,
      cookieName: config.cookieName,
      cookieMaxAgeDays: config.cookieMaxAgeDays,
    }

    bridge = new ProxyBridge(proxyConfig)
    await bridge.listen()
    ctx.log?.info?.(`[proxy-bridge] listening on 0.0.0.0:${config.port} → 127.0.0.1:${config.dshPort}`)
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

  function updateConfig(partial: Partial<BridgeConfigValue>): void {
    const oldPort = config.port
    const oldDshPort = config.dshPort
    const oldEnabled = config.enabled
    config = { ...config, ...partial }

    // Persist to settings.
    try {
      const settings = ctx.services.get(SettingsService) as SettingsService | undefined
      settings?.set(SETTINGS_NAMESPACE, config)
    } catch {
      // Best effort.
    }

    // Restart if the port or enabled state changed.
    if (config.port !== oldPort || config.dshPort !== oldDshPort || config.enabled !== oldEnabled) {
      void restart()
    }
  }

  function status(): { running: boolean; port: number; dshPort: number; hasPassword: boolean } {
    return {
      running: bridge?.isRunning ?? false,
      port: config.port,
      dshPort: config.dshPort,
      hasPassword: config.password.length > 0,
    }
  }

  return { bridge, get config() { return config }, start, stop, restart, updateConfig, status }
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
    }),
    async execute(input: z.infer<typeof tool.schema>) {
      const { command, port, dshPort, password } = input

      switch (command) {
        case 'status': {
          const s = controller.status()
          return {
            ok: true,
            message: s.running
              ? `Bridge running on 0.0.0.0:${s.port} → 127.0.0.1:${s.dshPort}${s.hasPassword ? ' (password protected)' : ''}`
              : `Bridge stopped (config: port=${s.port}, dshPort=${s.dshPort})`,
          }
        }
        case 'enable': {
          const updates: Partial<BridgeConfigValue> = { enabled: true }
          if (port !== undefined) updates.port = port
          if (dshPort !== undefined) updates.dshPort = dshPort
          controller.updateConfig(updates)
          await controller.start()
          const s = controller.status()
          return { ok: true, message: `Bridge enabled on 0.0.0.0:${s.port} → 127.0.0.1:${s.dshPort}` }
        }
        case 'disable': {
          controller.updateConfig({ enabled: false })
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
          controller.updateConfig(updates)
          const s = controller.status()
          return { ok: true, message: `Config updated. Bridge ${s.running ? 'running' : 'stopped'} on port ${s.port}.` }
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
