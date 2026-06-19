import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./shared/prisma";
import { logger } from "./shared/logger";

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info("server_listening", { url: `http://localhost:${env.port}`, env: env.nodeEnv });
});

// Apagado ordenado: deja de aceptar conexiones, cierra las en curso y suelta el
// pool de Prisma antes de salir (evita conexiones colgadas en deploys/rolling restart).
let cerrando = false;
async function shutdown(signal: string): Promise<void> {
  if (cerrando) return;
  cerrando = true;
  logger.info("server_shutdown", { signal });
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Red de seguridad: si algo se cuelga, forzar la salida.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
