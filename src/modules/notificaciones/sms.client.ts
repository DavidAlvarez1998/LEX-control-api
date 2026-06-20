// Canal SMS del microservicio de notificaciones (Háblame).
// POST /notificarViaSMS  body { toNumber, content, isPriority, isFlash }.
// OJO: responde 200 incluso al fallar → { message: "Ok" | "Falló" }; el envío
// solo se considera bueno si message === "Ok".
// ⚠️ De cobro: cada SMS consume saldo. Ver api_msm.odt.

import { postJson } from "./notificaciones.http";
import type { SmsParams, SmsResultado } from "./notificaciones.types";

export async function enviarSms(params: SmsParams): Promise<SmsResultado> {
  const { toNumber, content, isPriority = false, isFlash = false } = params;
  const data = await postJson<{ message?: string }>("/notificarViaSMS", {
    toNumber,
    content,
    isPriority,
    isFlash,
  });
  const mensajeProveedor = data?.message ?? "";
  return { enviado: mensajeProveedor.trim().toLowerCase() === "ok", mensajeProveedor };
}
