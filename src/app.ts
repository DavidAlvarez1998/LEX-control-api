import cors from "cors";
import express, { type Express } from "express";
import { env } from "./config/env";
import { errorHandler, notFound } from "./middleware/error";
import { authRoutes } from "./modules/auth/auth.router";
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
import { usuarioRoutes } from "./modules/usuarios/usuarios.router";
import { agendaRoutes, comisionRoutes, equipoComercialRoutes, prospectoRoutes, seguimientoRoutes } from "./modules/ventas/ventas.router";

/**
 * Builds the Express application: CORS for the configured frontend origins,
 * JSON parsing, the health check, and the 404 + error handlers. Feature routers
 * (auth, servicios) are mounted here in later batches.
 */
export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Feature routers:
  app.use("/auth", authRoutes);
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

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
