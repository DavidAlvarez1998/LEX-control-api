// Endpoints PÚBLICOS (sin auth) que alimentan la landing del portal cliente.
// Únicas superficies sin autenticación además de login/activación. Ver
// openspec/specs/public-marketing-api (change client-landing-page).
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { validate } from "../../middleware/validate";
import { solicitudCuentaSchema } from "./publico.schemas";

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
 * POST /publico/solicitud-cuenta — solicitud de creación de cuenta desde la landing
 * (sin auth). MODELO HÍBRIDO: crea un Prospecto (canalEntrada=WEB, estado=NUEVO =
 * pendiente de aprobación) con los datos del despacho + del usuario admin + el plan
 * elegido. NO crea acceso: el equipo lo aprueba (GANADO) y el flujo de ventas
 * provisiona Empresa + admin + suscripción. Honeypot `website`: si viene lleno es un
 * bot → no-op silencioso. NUNCA acepta `estado`/`empresaId` del cliente.
 */
publicoRoutes.post(
  "/solicitud-cuenta",
  validate({ body: solicitudCuentaSchema }),
  asyncHandler(async (req, res) => {
    const b = solicitudCuentaSchema.parse(req.body);
    if (b.website && b.website.trim() !== "") {
      res.json({ ok: true });
      return;
    }
    // Resuelve el plan elegido (clave → id) si vino y existe.
    const plan = b.planClave
      ? await prisma.plan.findUnique({ where: { clave: b.planClave }, select: { id: true } })
      : null;
    // Los datos de empresa que no tienen columna propia van a `notas` (referencia
    // para quien aprueba; el correo del admin = `email` será su login al provisionar).
    const notas = [
      "Solicitud de cuenta vía landing.",
      b.emailEmpresa ? `Correo empresa: ${b.emailEmpresa}` : null,
      b.telefonoEmpresa ? `Tel. empresa: ${b.telefonoEmpresa}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    await prisma.prospecto.create({
      data: {
        nombreEmpresa: b.nombreEmpresa,
        numeroDocumento: b.nit ?? null,
        nombreContacto: b.nombreContacto,
        email: b.email,
        telefono: b.telefono ?? null,
        canalEntrada: "WEB",
        planInteresId: plan?.id ?? null,
        notas,
      },
    });
    res.status(201).json({ ok: true });
  }),
);
