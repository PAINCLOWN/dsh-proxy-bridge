/**
 * Configuration field definitions for the DSH proxy bridge plugin.
 *
 * @module @riceawa/dsh-proxy-bridge/config-fields
 */

import z from '@deepseek-ai/schemastery'

/** The bridge's user-settings namespace. */
export const SETTINGS_NAMESPACE = 'proxy-bridge'

/** Default port the bridge listens on. */
export const DEFAULT_PORT = 3083

/** Default DSH port to forward to. */
export const DEFAULT_DSH_PORT = 3080

/** Default cookie name. */
export const DEFAULT_COOKIE_NAME = 'dsh_bridge_auth'

/** Default cookie lifetime in days. */
export const DEFAULT_COOKIE_MAX_AGE_DAYS = 30

/** Minimum password length when a password is set. */
export const MIN_PASSWORD_LENGTH = 8

/** The configuration schema. */
export const BridgeConfig = z.object({
  /** Whether the bridge listener is active. */
  enabled: z.boolean().default(false).volatile(),
  /** Port to bind on (0.0.0.0). */
  port: z.natural().min(1).max(65535).default(DEFAULT_PORT).volatile(),
  /** The loopback DSH web server port to forward to. */
  dshPort: z.natural().min(1).max(65535).default(DEFAULT_DSH_PORT).volatile(),
  /** Optional password for the bridge's session gate. Empty = no password. */
  password: z.string().default('').volatile(),
  /** Cookie name for the bridge session. */
  cookieName: z.string().default(DEFAULT_COOKIE_NAME).volatile(),
  /** Cookie lifetime in days. */
  cookieMaxAgeDays: z.natural().min(1).max(365).default(DEFAULT_COOKIE_MAX_AGE_DAYS).volatile(),
})

export type BridgeConfigValue = z.infer<typeof BridgeConfig>

/** Keys that are always present in the config. */
export const CONFIG_FIELD_KEYS = [
  'enabled',
  'port',
  'dshPort',
  'password',
  'cookieName',
  'cookieMaxAgeDays',
] as const

/** Keys that may be omitted (have defaults). */
export const OPTIONAL_CONFIG_KEYS = [
  'password',
  'cookieName',
  'cookieMaxAgeDays',
] as const
