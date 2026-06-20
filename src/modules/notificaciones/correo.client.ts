// Canal CORREO del microservicio de notificaciones (Amazon SES).
// POST /email/enviar  body { to, subject, html } → { ok, message, messageId }.
// ⚠️ De cobro: cada envío usa la cuenta SES del proveedor. Ver api_correo.odt.

import { postJson } from "./notificaciones.http";
import type { CorreoParams, CorreoResultado } from "./notificaciones.types";

export async function enviarCorreo(params: CorreoParams): Promise<CorreoResultado> {
  const { to, subject, html } = params;
  const data = await postJson<{ ok?: boolean; messageId?: string }>("/email/enviar", {
    to,
    subject,
    html,
  });
  return { enviado: data?.ok !== false, messageId: data?.messageId ?? null };
}
