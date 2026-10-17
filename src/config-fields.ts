/**
 * Configuration field definitions for the DSH proxy bridge plugin.
 *
 * @module @painclown/dsh-proxy-bridge/config-fields
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

/** Default self-signed certificate validity in days. */
export const DEFAULT_TLS_DAYS = 365

/**
 * The configuration schema.
 *
 * Note: deliberately NOT using schemastery's `.volatile()` modifier on these
 * fields. `.volatile()` resolves a field to a live getter/accessor object
 * (`{ get, [cosmokit.volatile.write] }`) instead of a plain value — fine for
 * fields meant to be read reactively, but it breaks plain consumers like
 * `scrypt(password, ...)` which require an actual string and blow up with
 * "the password argument must be of type string ... Received an instance of
 * Object". These are ordinary static plugin config fields, so plain
 * `.default(...)` is correct here.
 */
export const BridgeConfig = z.object({
  /** Whether the bridge listener is active. */
  enabled: z.boolean().default(false),
  /** Port to bind on (0.0.0.0). */
  port: z.natural().min(1).max(65535).default(DEFAULT_PORT),
  /** The loopback DSH web server port to forward to. */
  dshPort: z.natural().min(1).max(65535).default(DEFAULT_DSH_PORT),
  /** Optional password for the bridge's session gate. Empty = no password. */
  password: z.string().default(''),
  /** Cookie name for the bridge session. */
  cookieName: z.string().default(DEFAULT_COOKIE_NAME),
  /** Cookie lifetime in days. */
  cookieMaxAgeDays: z.natural().min(1).max(365).default(DEFAULT_COOKIE_MAX_AGE_DAYS),
  /** DSH browser-session secret (base64url) for auto-injecting DSH auth cookies. */
  dshSecret: z.string().default(''),
  /** Whether the ingress is encrypted (self TLS or a declared trusted terminator); adds `Secure` to cookies. */
  secureCookies: z.boolean().default(false),
  /** Whether to enable self-signed TLS (HTTPS listener). */
  tlsEnabled: z.boolean().default(false),
  /** Days for the self-signed certificate validity. */
  tlsDays: z.natural().min(1).max(3650).default(DEFAULT_TLS_DAYS),
  /** Hosts to include in the self-signed certificate SAN. */
  tlsHosts: z.array(z.string()).default([]),
  /** LAN CIDRs that may be treated as trusted. */
  lanCidrs: z.array(z.string()).default([]),
  /** Whether LAN/loopback sources may skip the gateway login (explicit opt-in). */
  lanPasswordless: z.boolean().default(false),
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
  'dshSecret',
  'secureCookies',
  'tlsEnabled',
  'tlsDays',
  'tlsHosts',
  'lanCidrs',
  'lanPasswordless',
] as const

/** Keys that may be omitted (have defaults). */
export const OPTIONAL_CONFIG_KEYS = [
  'password',
  'cookieName',
  'cookieMaxAgeDays',
  'dshSecret',
  'secureCookies',
  'tlsEnabled',
  'tlsDays',
  'tlsHosts',
  'lanCidrs',
  'lanPasswordless',
] as const
