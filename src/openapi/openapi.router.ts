// Sirve el documento OpenAPI (/openapi.json) y la UI de Swagger (/docs).
import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { buildOpenApiDocument } from "./openapi";

const document = buildOpenApiDocument();

export const openapiRoutes: Router = Router();

openapiRoutes.get("/openapi.json", (_req, res) => res.json(document));
openapiRoutes.use("/docs", swaggerUi.serve, swaggerUi.setup(document, { customSiteTitle: "LEX Control API" }));
