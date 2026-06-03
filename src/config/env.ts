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
};

export const isProd = env.nodeEnv === "production";
