// Documento OpenAPI 3.0 generado desde los MISMOS esquemas Zod que validan las
// peticiones (zod-to-openapi), de modo que la doc no se desincronice del contrato.
// Cubre una selección representativa de la superficie (auth, procesos, clientes,
// facturación) + los componentes comunes (error, sobre paginado, seguridad JWT).
// Servido como JSON en /openapi.json y como Swagger UI en /docs (ver openapi.router).
import { z } from "zod";
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { loginSchema, setPasswordSchema } from "../modules/auth/auth.schemas";
import { createProcesoSchema } from "../modules/procesos/procesos.schemas";
import { createClienteSchema } from "../modules/clientes/clientes.schemas";
import { createFacturaSchema, pagoFacturaSchema } from "../modules/facturacion/facturacion.schemas";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

const bearer = registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});
const auth = [{ [bearer.name]: [] }];

// --- Componentes reutilizables ---
const ErrorResponse = registry.register(
  "Error",
  z.object({
    error: z.object({
      message: z.string().openapi({ example: "No autorizado" }),
      issues: z.unknown().optional(),
    }),
  }),
);

/** Sobre de paginación uniforme: { items, total, page, pageSize }. */
const Paginado = registry.register(
  "Paginado",
  z.object({
    items: z.array(z.unknown()),
    total: z.number().int().openapi({ example: 137 }),
    page: z.number().int().openapi({ example: 1 }),
    pageSize: z.number().int().openapi({ example: 20 }),
  }),
);

// Registrar los esquemas de request como componentes nombrados (se referencian abajo).
const Login = registry.register("LoginInput", loginSchema);
const SetPassword = registry.register("SetPasswordInput", setPasswordSchema);
const CreateProceso = registry.register("CreateProcesoInput", createProcesoSchema);
const CreateCliente = registry.register("CreateClienteInput", createClienteSchema);
const CreateFactura = registry.register("CreateFacturaInput", createFacturaSchema);
const PagoFactura = registry.register("PagoFacturaInput", pagoFacturaSchema);

const jsonBody = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });
const errores = {
  400: { description: "Datos inválidos", ...jsonBody(ErrorResponse) },
  401: { description: "No autenticado", ...jsonBody(ErrorResponse) },
  404: { description: "No encontrado", ...jsonBody(ErrorResponse) },
};

const paginacionQuery = z.object({
  page: z.coerce.number().int().min(1).optional().openapi({ example: 1 }),
  pageSize: z.coerce.number().int().min(1).max(100).optional().openapi({ example: 20 }),
  q: z.string().optional().openapi({ description: "Búsqueda libre" }),
});

// --- Salud ---
registry.registerPath({
  method: "get", path: "/health", tags: ["Sistema"], summary: "Health check",
  responses: { 200: { description: "OK", ...jsonBody(z.object({ status: z.literal("ok") })) } },
});

// --- Auth ---
registry.registerPath({
  method: "post", path: "/auth/login", tags: ["Auth"], summary: "Iniciar sesión (devuelve JWT)",
  request: { body: jsonBody(Login) },
  responses: {
    200: { description: "Token + datos de usuario", ...jsonBody(z.object({ token: z.string(), user: z.unknown() })) },
    401: { description: "Credenciales o portal inválidos", ...jsonBody(ErrorResponse) },
  },
});
registry.registerPath({
  method: "post", path: "/auth/set-password", tags: ["Auth"], summary: "Definir contraseña vía enlace de activación",
  request: { body: jsonBody(SetPassword) },
  responses: { 200: { description: "OK" }, 400: errores[400] },
});

// --- Procesos ---
registry.registerPath({
  method: "get", path: "/procesos", tags: ["Procesos"], summary: "Listar procesos (paginado)",
  security: auth, request: { query: paginacionQuery },
  responses: { 200: { description: "Sobre paginado de procesos", ...jsonBody(Paginado) }, 401: errores[401] },
});
registry.registerPath({
  method: "post", path: "/procesos", tags: ["Procesos"], summary: "Crear proceso",
  security: auth, request: { body: jsonBody(CreateProceso) },
  responses: { 201: { description: "Proceso creado" }, ...errores },
});
registry.registerPath({
  method: "get", path: "/procesos/{id}", tags: ["Procesos"], summary: "Detalle de un proceso",
  security: auth, request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: "Detalle del proceso" }, 401: errores[401], 404: errores[404] },
});

// --- Clientes (CRM) ---
registry.registerPath({
  method: "get", path: "/clientes", tags: ["Clientes"], summary: "Listar clientes/prospectos",
  security: auth, request: { query: z.object({ estado: z.string().optional(), mios: z.coerce.boolean().optional() }) },
  responses: { 200: { description: "Lista de clientes" }, 401: errores[401] },
});
registry.registerPath({
  method: "post", path: "/clientes", tags: ["Clientes"], summary: "Crear cliente/prospecto",
  security: auth, request: { body: jsonBody(CreateCliente) },
  responses: { 201: { description: "Cliente creado" }, ...errores },
});

// --- Facturación ---
registry.registerPath({
  method: "post", path: "/facturacion/facturas", tags: ["Facturación"], summary: "Crear factura (borrador)",
  security: auth, request: { body: jsonBody(CreateFactura) },
  responses: { 201: { description: "Factura creada" }, ...errores },
});
registry.registerPath({
  method: "post", path: "/facturacion/facturas/{id}/pagos", tags: ["Facturación"],
  summary: "Registrar pago (idempotente por numeroComprobante)",
  security: auth, request: { params: z.object({ id: z.string() }), body: jsonBody(PagoFactura) },
  responses: { 201: { description: "Factura con estado de pago derivado" }, ...errores, 409: { description: "La factura no está emitida", ...jsonBody(ErrorResponse) } },
});

// Tipo de retorno portable (OpenAPIObject vive en un dep transitivo, no importable).
export function buildOpenApiDocument(): Record<string, unknown> {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  const document = generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "LEX Control API",
      version: "1.0.0",
      description: "Capa de datos/servicios de LEX Control. Doc generada desde los esquemas Zod de validación.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "Sistema" }, { name: "Auth" }, { name: "Procesos" },
      { name: "Clientes" }, { name: "Facturación" },
    ],
  });
  return document as unknown as Record<string, unknown>;
}
