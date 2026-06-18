import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { errorHandler, notFound } from "./middleware/error";
import { requestId } from "./shared/logger";
import { authRoutes } from "./modules/auth/auth.router";
import { buscarRoutes } from "./modules/buscar/buscar.router";
import { catalogRoutes } from "./modules/catalog/catalog.router";
import { clienteRoutes } from "./modules/clientes/clientes.router";
import { comercialRoutes } from "./modules/comercial/comercial.router";
import { contableRoutes } from "./modules/contable/contable.router";
import { contratoRoutes } from "./modules/contratos/contratos.router";
import { empresaRoutes } from "./modules/empresas/empresas.router";
import { facturacionRoutes } from "./modules/facturacion/facturacion.router";
import { litiganteRoutes } from "./modules/litigantes/litigantes.router";
import { miEmpresaRoutes } from "./modules/mi-empresa/mi-empresa.router";
import { planRoutes } from "./modules/planes/planes.router";
import { servicioRoutes } from "./modules/servicios/servicios.router";
import { procesoRoutes } from "./modules/procesos/procesos.router";
import { integracionRoutes } from "./modules/integraciones/integraciones.router";
import { publicoRoutes } from "./modules/publico/publico.router";
import { usuarioRoutes } from "./modules/usuarios/usuarios.router";
import { agendaRoutes, comisionRoutes, equipoComercialRoutes, prospectoRoutes, seguimientoRoutes } from "./modules/ventas/ventas.router";

/**
 * Builds the Express application: CORS for the configured frontend origins,
 * JSON parsing, the health check, and the 404 + error handlers. Feature routers
 * (auth, servicios) are mounted here in later batches.
 */
// Rate limit de superficies SIN auth (anti brute-force / spam). Se omite en test
// (la suite hace muchos logins) y NO toca /auth/me (lo llama el front al refrescar).
const noTest = () => env.nodeEnv === "test";
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, skip: noTest });
const publicoLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, skip: noTest });

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(requestId);

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Rate limit en las superficies de credenciales/registro (no autenticadas).
  app.use("/auth/login", authLimiter);
  app.use("/auth/set-password", authLimiter);

  // Feature routers:
  app.use("/auth", authRoutes);
  // Búsqueda global (consciente de rol; ramifica por tipo de usuario).
  app.use("/buscar", buscarRoutes);
  app.use("/empresas", empresaRoutes);
  app.use("/mi-empresa", miEmpresaRoutes);
  app.use("/servicios", servicioRoutes);
  app.use("/usuarios", usuarioRoutes);
  app.use("/planes", planRoutes);
  app.use("/clientes", clienteRoutes);
  app.use("/comercial", comercialRoutes);
  app.use("/contable", contableRoutes);
  // Módulo de contratos (RRHH del personal): despacho + comerciales de plataforma.
  app.use("/contratos", contratoRoutes);
  app.use("/facturacion", facturacionRoutes);
  // Venta de la plataforma (CRM propio): prospectos + comisiones.
  app.use("/prospectos", prospectoRoutes);
  app.use("/comisiones", comisionRoutes);
  // Agenda (pendientes por comercial) + seguimientos sueltos por id.
  app.use("/agenda", agendaRoutes);
  app.use("/seguimientos", seguimientoRoutes);
  // Resumen del equipo comercial (vista ADMIN).
  app.use("/equipo-comercial", equipoComercialRoutes);
  // Módulo de procesos legales (Colombia).
  app.use("/catalogo", catalogRoutes);
  app.use("/litigantes", litiganteRoutes);
  app.use("/procesos", procesoRoutes);
  // Integraciones estatales (Fase A: jurisprudencia de la Corte Constitucional).
  app.use("/integraciones", integracionRoutes);
  app.use("/publico", publicoLimiter, publicoRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
