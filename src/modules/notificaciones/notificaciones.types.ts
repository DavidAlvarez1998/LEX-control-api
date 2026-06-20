// DTOs normalizados del microservicio de notificaciones (API_NOTIFICAR).
// El negocio y, en el futuro, el front consumen SOLO estas formas — nunca el
// JSON crudo del proveedor. Ver openspec/roadmap-docs/APIs/*.odt.

// ── Correo (Amazon SES vía nodemailer) ──
export type CorreoParams = {
  /** Correo destino. */
  to: string;
  /** Asunto. */
  subject: string;
  /** Cuerpo HTML (el proveedor lo inserta dentro de su plantilla con logo). */
  html: string;
};
export type CorreoResultado = {
  /** true si el proveedor confirmó el envío (`ok !== false`). */
  enviado: boolean;
  /** Id del mensaje SES, si lo devolvió. */
  messageId: string | null;
};

// ── SMS (Háblame) ──
export type SmsParams = {
  /** Número con indicativo país, SIN "+". Ej: "573105399184". */
  toNumber: string;
  /** Texto del mensaje. */
  content: string;
  /** Envío prioritario en Háblame. Default false. */
  isPriority?: boolean;
  /** SMS flash (aparece en pantalla, no se guarda). Default false. */
  isFlash?: boolean;
};
export type SmsResultado = {
  /** true solo si el proveedor respondió `{ message: "Ok" }`. OJO: el proveedor
   *  responde 200 incluso cuando Háblame rechaza (`message: "Falló"`). */
  enviado: boolean;
  /** El `message` crudo del proveedor ("Ok" | "Falló" | …). */
  mensajeProveedor: string;
};

// ── Llamadas TTS (Go4Clients) ──
export type LlamadaParams = {
  /** Número destino. Acepta 3105399184 / 573105399184 / +57… (el proveedor normaliza). */
  telefono: string;
  /** Texto que dirá la voz (TTS). El proveedor tiene un default. */
  mensaje?: string;
  /** Voz TTS (default "PEDRO"). */
  voice?: string;
  /** Velocidad 80–120 (default 100). */
  speed?: number;
  /** Nombre de campaña. */
  campaignName?: string;
  /** Hora mínima para llamar ("06:00"). */
  earliestTimeToCall?: string;
  /** URL para el callback de Go4. */
  callbackUrl?: string;
};
export type LlamadaDisparo = {
  ok: boolean;
  /** Id de campaña Go4 — necesario para consultar el estado. */
  campaignId: string;
  /** Número destino normalizado por el proveedor. */
  dest: string | null;
};
export type EstadoLlamada = {
  ok: boolean;
  campaignId: string;
  /** answered | no_answer | failed | en_progreso | pendiente. */
  estado: string;
  descripcion: string | null;
  /** true cuando el estado es DEFINITIVO (dejar de consultar). */
  termino: boolean;
  duracionSeg: number | null;
  intento: number | null;
  costo: number | null;
};
