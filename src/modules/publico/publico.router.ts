// Endpoints PÚBLICOS (sin auth) que alimentan la landing del portal cliente.
// Únicas superficies sin autenticación además de login/activación. Ver
// openspec/specs/public-marketing-api (change client-landing-page).
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { validate } from "../../middleware/validate";
import { solicitarDemoSchema } from "./publico.schemas";

export const publicoRoutes: Router = Router();
const n = (d: Prisma.Decimal) => Number(d);

/**
 * GET /publico/planes — catálogo de planes para la landing (solo lectura, sin auth).
 * Solo planes `activo`, ordenados por `orden`. Proyección MÍNIMA: nada de ids
 * internos, suscripciones ni datos de empresa.
 */
publicoRoutes.get(
  "/planes",
  asyncHandler(async (_req, res) => {
    const planes = await prisma.plan.findMany({
      where: { activo: true },
      orderBy: { orden: "asc" },
      select: {
        clave: true,
        nombre: true,
        descripcion: true,
        precioMensual: true,
        modulos: { select: { modulo: { select: { clave: true } } } },
        cuotas: { select: { rolEmpresa: true, limite: true } },
      },
    });
    res.json(
      planes.map((p) => ({
        clave: p.clave,
        nombre: p.nombre,
        descripcion: p.descripcion,
        precioMensual: n(p.precioMensual),
        modulos: p.modulos.map((m) => m.modulo.clave),
        cuotas: Object.fromEntries(p.cuotas.map((c) => [c.rolEmpresa, c.limite])),
      })),
    );
  }),
);

/**
 * POST /publico/solicitar-demo — capta un lead desde la landing (sin auth). Crea
 * un Prospecto (canalEntrada=WEB, estado=NUEVO) que aterriza en el embudo comercial
 * (/prospectos). Honeypot `website`: si viene lleno es un bot → no-op silencioso.
 * NUNCA acepta `estado`/`empresaId` del cliente.
 */
publicoRoutes.post(
  "/solicitar-demo",
  validate({ body: solicitarDemoSchema }),
  asyncHandler(async (req, res) => {
    const b = solicitarDemoSchema.parse(req.body);
    if (b.website && b.website.trim() !== "") {
      // Bot: respondemos éxito benigno sin crear nada.
      res.json({ ok: true });
      return;
    }
    await prisma.prospecto.create({
      data: {
        nombreEmpresa: b.nombreEmpresa,
        nombreContacto: b.nombreContacto,
        email: b.email,
        telefono: b.telefono ?? null,
        canalEntrada: "WEB",
        notas: b.mensaje ?? null,
      },
    });
    res.status(201).json({ ok: true });
  }),
);
