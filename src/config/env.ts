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
    // El entorno demo del microservicio NO está operativo: usamos PRODUCCIÓN y
    // aislamos nuestros datos de prueba bajo la carpeta raíz `demo-lex-control`.
    apiUrl: (
      process.env.DOCUMENTOS_API_URL ?? "https://documentos.tecnovapp.com.co"
    ).replace(/\/+$/, ""),
    // Carpeta raíz {EMPRESA} bajo la que se agrupan TODOS los archivos de la
    // plataforma en el microservicio. Las subcarpetas ({CARPETA}) las decide
    // cada módulo en código (p. ej. "contratos").
    empresa: process.env.DOCUMENTOS_EMPRESA ?? "demo-lex-control",
    // Timeout de subida (ms): un archivo puede tardar más que una request normal.
    timeoutMs: Number(process.env.DOCUMENTOS_TIMEOUT_MS ?? 30_000),
  },

  // Integraciones con sistemas estatales (Fase A: Corte Constitucional vía API
  // pública Socrata de datos.gov.co). El `datasetId` debe apuntar al dataset real
  // de la relatoría; `appToken` es opcional (sube los límites de rate de Socrata).
  // Ver openspec/specs/integraciones-estatales/spec.md.
  integraciones: {
    corteConstitucional: {
      baseUrl: (process.env.CORTE_CONST_API_URL ?? "https://www.datos.gov.co").replace(/\/+$/, ""),
      datasetId: process.env.CORTE_CONST_DATASET ?? "9kfd-kup7",
      appToken: process.env.SOCRATA_APP_TOKEN, // opcional
      timeoutMs: Number(process.env.INTEGRACIONES_TIMEOUT_MS ?? 15_000),
    },
  },
};

export const isProd = env.nodeEnv === "production";
