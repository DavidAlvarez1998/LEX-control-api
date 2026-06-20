import "dotenv/config";

/**
 * Reads a required environment variable. Fails fast (exits the process) if it
 * is missing, so the server never starts in a half-configured state.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[config] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const DEFAULT_ORIGINS = "http://localhost:3000,http://localhost:3001";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: required("JWT_SECRET"),
  corsOrigins: (process.env.CORS_ORIGINS ?? DEFAULT_ORIGINS)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  // URLs de los portales, para construir el link de activación según el rol.
  // En prod se setean CLIENT_URL / ADMIN_URL (ej. https://app.tudominio.com).
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:3001",
  adminUrl: process.env.ADMIN_URL ?? "http://localhost:3000",

  // API documental externa (tecnovapp): microservicio que almacena y sirve los
  // archivos (PDFs, imágenes) del sistema. Guardamos solo el `path` relativo que
  // devuelve (NO la URL completa: así un cambio de dominio no rompe registros
  // viejos); el binario vive allá. Ver openspec/roadmap-docs/API-DOCUMENTOS-INTEGRACION.md.
  documentos: {
    // Base URL sin barra final (se concatena con /api/documento y /documentos).
    apiUrl: (
      process.env.DOCUMENTOS_API_URL ?? "https://documentos.tecnovapp.com.co"
    ).replace(/\/+$/, ""),
    // Prefijo de la RAÍZ {EMPRESA} en tecnovapp (compartido entre productos). La
    // raíz real es `{raizPrefijo}-{TENANT}` donde TENANT = "ADMIN" o
    // "{slug}-{empresaId}" (ver carpetaTenant en documentos.client.ts). Así cada
    // despacho es su propia raíz (convención multi-tenant del doc, §9.1) y todo
    // queda namespaceado por producto/entorno (DEMO-LEXCONTROL vs LEXCONTROL).
    raizPrefijo: (process.env.DOCUMENTOS_RAIZ_PREFIJO ?? "DEMO-LEXCONTROL").replace(/\/+$/, ""),
    // Timeout de subida (ms): un archivo puede tardar más que una request normal.
    timeoutMs: Number(process.env.DOCUMENTOS_TIMEOUT_MS ?? 30_000),
  },

  // Microservicio interno de NOTIFICACIONES (proyecto API_NOTIFICAR /
  // solucredito-hablame-1): correo (Amazon SES), SMS (Háblame) y llamadas TTS
  // (Go4Clients). Mismo host para los tres canales, SIN auth (red interna), HTTP.
  // ⚠️ De COBRO: enviar correo/SMS/llamada consume saldo. No probar contra el
  // proveedor real salvo a propósito. Ver openspec/roadmap-docs/APIs/*.odt.
  notificaciones: {
    // Base URL sin barra final. Por defecto el host interno del documento; en
    // prod/staging se setea NOTIFICAR_API_URL al host alcanzable desde la API.
    baseUrl: (process.env.NOTIFICAR_API_URL ?? "http://10.10.10.211:5020").replace(/\/+$/, ""),
    // Timeout por request (ms). Una llamada/SMS no debe colgar la API.
    timeoutMs: Number(process.env.NOTIFICAR_TIMEOUT_MS ?? 15_000),
  },
};

export const isProd = env.nodeEnv === "production";
