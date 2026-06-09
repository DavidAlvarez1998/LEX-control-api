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
