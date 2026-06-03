import cors from "cors";
import express, { type Express } from "express";
import { env } from "./config/env";
import { errorHandler, notFound } from "./middleware/error";
import { authRoutes } from "./modules/auth/auth.router";
import { empresaRoutes } from "./modules/empresas/empresas.router";
import { servicioRoutes } from "./modules/servicios/servicios.router";

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
  app.use("/servicios", servicioRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
