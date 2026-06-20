// Capacidad de NOTIFICACIONES (API_NOTIFICAR): correo, SMS y llamadas TTS.
// Punto de entrada del módulo — el negocio importa desde aquí. NO hay router ni
// consumo desde el front todavía (solo la capacidad backend).
export { enviarCorreo } from "./correo.client";
export { enviarSms } from "./sms.client";
export { llamar, consultarEstadoLlamada, consultarBalanceGo4 } from "./llamadas.client";
export type {
  CorreoParams,
  CorreoResultado,
  SmsParams,
  SmsResultado,
  LlamadaParams,
  LlamadaDisparo,
  EstadoLlamada,
} from "./notificaciones.types";
