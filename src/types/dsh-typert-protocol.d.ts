/**
 * Ambient type declaration for `@deepseek-ai/dsh-typert-protocol`.
 *
 * The module is provided by the DSH host at runtime — it is not a declared
 * dependency of this plugin and is not installed in node_modules, so the
 * build externalizes the import. This declaration supplies the types the
 * host exposes so `tsc --noEmit` can typecheck the plugin.
 *
 * Mirrors the real API in
 * /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/
 * dsh-typert-protocol/lib/types/index.d.ts.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  import type { Context, Service } from '@deepseek-ai/cordis'

  export interface TypertGatewayBindingOptions {
    /** The Remote namespace this service is bound to (e.g. "bridge"). */
    readonly namespace?: string
  }

  /**
   * Base class for host-side Remote services. Instantiating a subclass
   * self-registers it with the Typert Gateway; methods marked with
   * {@link Remote} become callable from the client via `ctx.remote.<ns>`.
   */
  export abstract class TypertRemoteService<out T = never> extends Service<T> {
    protected constructor(
      ctx: Context,
      serviceKey: string,
      options?: TypertGatewayBindingOptions,
    )
  }

  /**
   * The method-decorator context shape the DSH `__esDecorate` transform
   * supplies. Note it uses `name` (not the standard `key`) — the real
   * `Remote` implementation reads `context.name`.
   */
  export interface DshRemoteMethodContext {
    readonly kind: 'method'
    readonly name: string
    readonly static: boolean
    readonly private: boolean
    readonly access: {
      has(object: object): boolean
      get(object: object): unknown
      set?(object: object, value: unknown): void
    }
    addInitializer(initializer: () => void): void
  }

  /**
   * Marks a method as remotely callable. Used as a direct decorator
   * (`@Remote`) — the form the DSH host controllers use. The plugin applies
   * it manually (no decorator syntax) via the (method, context) call.
   */
  export function Remote(
    method: unknown,
    context: DshRemoteMethodContext,
  ): void
  /** Factory form: `@Remote("name")` / `@Remote({ ... })`. */
  export function Remote(
    name: string,
  ): (method: unknown, context: DshRemoteMethodContext) => void
}
