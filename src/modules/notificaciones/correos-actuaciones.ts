// Aviso por correo de NOVEDADES en un proceso (actuaciones nuevas detectadas por el
// sync de la Rama). Best-effort: arma la plantilla, llama enviarCorreo (SES) y NUNCA
// lanza (si falla, lo registra y devuelve false). Ver openspec/changes/rama-judicial-actuaciones.
import { logger } from "../../shared/logger";
import { enviarCorreo } from "./correo.client";

export async function enviarNovedadActuaciones(p: {
  to: string;
  nombre: string; // abogado responsable
  procesoTitulo: string;
  radicado: string | null;
  nuevas: number;
  ultima: string | null; // título de la actuación más reciente
}): Promise<boolean> {
  const plural = p.nuevas === 1 ? "una actuación nueva" : `${p.nuevas} actuaciones nuevas`;
  const html = [
    `<h2 style="margin:0 0 12px">Novedad en un proceso</h2>`,
    `<p style="margin:0 0 16px;line-height:1.5">Hola, ${p.nombre}: el proceso `,
    `<strong>${p.procesoTitulo}</strong>`,
    p.radicado ? ` (radicado ${p.radicado})` : "",
    ` tiene <strong>${plural}</strong> en la Rama Judicial.</p>`,
    p.ultima ? `<p style="margin:0 0 16px">Última actuación: <strong>${p.ultima}</strong>.</p>` : "",
    `<p style="margin:0;font-size:13px;color:#475569">Ingresa a LEX Control para ver el detalle en la ficha del proceso.</p>`,
  ].join("");

  try {
    const { enviado } = await enviarCorreo({
      to: p.to,
      subject: `Novedad en tu proceso: ${p.procesoTitulo}`,
      html,
    });
    return enviado;
  } catch (err) {
    logger.warn("correo de novedad de actuaciones no enviado", { to: p.to, err: String(err) });
    return false;
  }
}
