/**
 * Client entry point for the DSH proxy bridge plugin.
 * Registers the config card on the DSH Plugins page (Installed plugins section).
 *
 * @module @painclown/dsh-proxy-bridge/client
 */

import { BridgeCard } from './bridge-card.tsx'

const inject = ['slots']

function apply(ctx: any): void {
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: '@painclown/dsh-proxy-bridge',
  }, BridgeCard))
}

export { apply, inject }
