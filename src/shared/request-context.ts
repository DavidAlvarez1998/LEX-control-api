// Contexto por request propagado con AsyncLocalStorage: permite que cualquier
// log emitido durante el ciclo de vida de una petición incluya el reqId (y método
// /ruta) sin tener que pasar el `req` por toda la cadena de servicios/repos.
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  reqId: string;
  method: string;
  path: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Corre `fn` con el contexto activo (lo usa el middleware de request-id). */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Devuelve el contexto de la petición en curso, si hay uno. */
export function getContext(): RequestContext | undefined {
  return storage.getStore();
}
