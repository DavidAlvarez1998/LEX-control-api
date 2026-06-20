// Canal LLAMADAS TTS del microservicio de notificaciones (Go4Clients).
// Trabajan en dos pasos:
//   POST /go4/llamar            → dispara la llamada, devuelve { campaignId }
//   GET  /go4/estado/:campaignId → estado (consultar hasta `termino === true`)
// ⚠️ De cobro: cada llamada consume saldo Go4. Ver api_llamadas.odt.

import { getJson, postJson } from "./notificaciones.http";
import type { EstadoLlamada, LlamadaDisparo, LlamadaParams } from "./notificaciones.types";

/** Dispara la llamada. Guarda el `campaignId` para consultar el estado luego. */
export async function llamar(params: LlamadaParams): Promise<LlamadaDisparo> {
  // JSON.stringify omite los opcionales `undefined`: solo viaja lo provisto.
  const data = await postJson<{ ok?: boolean; campaignId?: string; dest?: string }>("/go4/llamar", {
    telefono: params.telefono,
    mensaje: params.mensaje,
    voice: params.voice,
    speed: params.speed,
    campaignName: params.campaignName,
    earliestTimeToCall: params.earliestTimeToCall,
    callbackUrl: params.callbackUrl,
  });
  return { ok: data?.ok === true, campaignId: data?.campaignId ?? "", dest: data?.dest ?? null };
}

/** Consulta el resultado de una llamada. `termino === true` = estado definitivo. */
export async function consultarEstadoLlamada(campaignId: string): Promise<EstadoLlamada> {
  const data = await getJson<{
    ok?: boolean;
    campaignId?: string;
    estado?: string;
    descripcion?: string;
    termino?: boolean;
    duracion_seg?: number;
    intento?: number;
    costo?: number;
  }>(`/go4/estado/${encodeURIComponent(campaignId)}`);
  return {
    ok: data?.ok === true,
    campaignId: data?.campaignId ?? campaignId,
    estado: data?.estado ?? "pendiente",
    descripcion: data?.descripcion ?? null,
    termino: data?.termino === true,
    duracionSeg: data?.duracion_seg ?? null,
    intento: data?.intento ?? null,
    costo: data?.costo ?? null,
  };
}

/** Saldo de la cuenta Go4 (consulta, no genera cobro de envío). */
export function consultarBalanceGo4(): Promise<unknown> {
  return getJson("/go4/balance");
}
