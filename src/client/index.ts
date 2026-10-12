/**
 * Client entry point for the DSH proxy bridge plugin.
 * Registers the config card on the DSH Plugins page.
 *
 * @module @painclown/dsh-proxy-bridge/client
 */

import type { ClientContext } from '@deepseek-ai/cordis'
import { BridgeCard } from './bridge-card.tsx'

export default function proxyBridgeClient(ctx: ClientContext): void {
  // Register the config card in the plugins bundle config slot.
  ctx.slots?.register?.('plugins.bundle.config', {
    id: 'proxy-bridge-config',
    component: BridgeCard,
  })
}
