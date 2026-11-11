/**
 * Client entry point for the DSH proxy bridge plugin.
 * Registers the config card on the DSH Plugins page (Installed plugins section).
 *
 * @module @painclown/dsh-proxy-bridge/client
 */

import React from 'react'
import { BridgeCard } from './bridge-card.tsx'

const inject = ['slots']

function apply(ctx: any): void {
  ctx.slots.inject('plugins.bundle.config', () => {
    // Wrap BridgeCard so it receives `ctx` (the host service surface,
    // including ctx.remote.bridge) without the slot system having to know
    // about it. index.ts is a .ts file, so use createElement (no JSX).
    const Card = (props: Record<string, never>): React.JSX.Element =>
      React.createElement(BridgeCard, { ...props, ctx })
    ctx.slots.register({
      name: 'plugins.bundle.config',
      key: '@painclown/dsh-proxy-bridge',
    }, Card)
  })
}

export { apply, inject }
