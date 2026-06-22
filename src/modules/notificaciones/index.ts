// Capacidad de NOTIFICACIONES (API_NOTIFICAR): correo, SMS y llamadas TTS.
// Punto de entrada del módulo — el negocio importa desde aquí. NO hay router ni
// consumo desde el front todavía (solo la capacidad backend).
export { enviarCorreo } from "./correo.client";
// Correos transaccionales de cuenta (consumidores: usuarios / mi-empresa).
export { enviarInvitacionCuenta, enviarResetCuenta } from "./correos-cuenta";
export type { ContextoInvitacion } from "./plantillas-cuenta";
// Aviso de novedades de actuaciones (consumidor: sync Rama Judicial / cron).
export { enviarNovedadActuaciones } from "./correos-actuaciones";
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
