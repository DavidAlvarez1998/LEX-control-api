// Búsqueda global (v1). Un único endpoint que ramifica por el tipo de usuario y
// devuelve resultados ya filtrados por rol/permiso, listos para el desplegable
// del topbar. La seguridad reusa lo que ya existe: el staff de plataforma
// (ADMIN/COMERCIAL) ve prospectos/empresas; el usuario de despacho ve sus
// clientes/procesos SOLO si tiene el permiso (`cliente.ver`/`proceso.ver`), y
// siempre acotado a su `empresaId`. Ver topbar GlobalSearch en los frontends.
import { Router, type Request } from "express";
import { Rol } from "@prisma/client";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, tienePermiso } from "../../middleware/auth";

export const buscarRoutes: Router = Router();

/** Un resultado plano, listo para pintar y navegar en el frontend. */
type Resultado = {
  tipo:
    | "cliente"
    | "proceso"
    | "factura"
    | "usuario"
    | "contrato"
    | "prospecto"
    | "empresa"
    | "plan";
  id: string;
  titulo: string;
  subtitulo: string | null;
};

const POR_TIPO = 5; // máximo de resultados por entidad
const esComercial = (req: Request) => req.user!.rol === Rol.COMERCIAL;

/** GET /buscar?q= — búsqueda global consciente del rol. */
buscarRoutes.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 2) {
      res.json({ resultados: [] });
      return;
    }

    const resultados: Resultado[] = [];
    const rol = req.user!.rol;

    if (rol === Rol.ADMIN || rol === Rol.COMERCIAL) {
      // Staff de plataforma: prospectos (el COMERCIAL solo los suyos) y empresas
      // (solo ADMIN). Sin tenancy por empresa.
      const prospectos = await prisma.prospecto.findMany({
        where: {
          ...(esComercial(req) ? { comercialId: req.user!.sub } : {}),
          OR: [
            { nombreEmpresa: { contains: q } },
            { nombreContacto: { contains: q } },
            { numeroDocumento: { contains: q } },
            { telefono: { contains: q } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: POR_TIPO,
        select: { id: true, nombreEmpresa: true, nombreContacto: true },
      });
      for (const p of prospectos) {
        resultados.push({
          tipo: "prospecto",
          id: p.id,
          titulo: p.nombreEmpresa,
          subtitulo: p.nombreContacto,
        });
      }

      if (rol === Rol.ADMIN) {
        const empresas = await prisma.empresa.findMany({
          where: {
            OR: [
              { nombre: { contains: q } },
              { rfc: { contains: q } },
              { email: { contains: q } },
            ],
          },
          orderBy: { nombre: "asc" },
          take: POR_TIPO,
          select: { id: true, nombre: true, rfc: true },
        });
        for (const e of empresas) {
          resultados.push({
            tipo: "empresa",
            id: e.id,
            titulo: e.nombre,
            subtitulo: e.rfc ? `NIT ${e.rfc}` : null,
          });
        }

        const planes = await prisma.plan.findMany({
          where: { OR: [{ nombre: { contains: q } }, { clave: { contains: q } }] },
          orderBy: { orden: "asc" },
          take: POR_TIPO,
          select: { id: true, nombre: true, clave: true },
        });
        for (const pl of planes) {
          resultados.push({ tipo: "plan", id: pl.id, titulo: pl.nombre, subtitulo: pl.clave });
        }

        const usuarios = await prisma.usuario.findMany({
          where: { OR: [{ nombre: { contains: q } }, { email: { contains: q } }] },
          orderBy: { nombre: "asc" },
          take: POR_TIPO,
          select: { id: true, nombre: true, email: true },
        });
        for (const u of usuarios) {
          resultados.push({ tipo: "usuario", id: u.id, titulo: u.nombre, subtitulo: u.email });
        }
      }
    } else if (req.empresaId) {
      // Usuario de despacho: clientes y procesos, acotados a su empresa y a sus
      // permisos. Si no tiene el permiso, ni se consulta esa entidad.
      const empresaId = req.empresaId;

      if (await tienePermiso(req, "cliente.ver")) {
        const clientes = await prisma.cliente.findMany({
          where: {
            empresaId,
            OR: [
              { nombre: { contains: q } },
              { numeroDocumento: { contains: q } },
              { telefono: { contains: q } },
              { email: { contains: q } },
            ],
          },
          orderBy: { fechaIngreso: "desc" },
          take: POR_TIPO,
          select: { id: true, nombre: true, numeroDocumento: true },
        });
        for (const c of clientes) {
          resultados.push({
            tipo: "cliente",
            id: c.id,
            titulo: c.nombre,
            subtitulo: c.numeroDocumento ? `CC ${c.numeroDocumento}` : null,
          });
        }
      }

      if (await tienePermiso(req, "proceso.ver")) {
        const procesos = await prisma.proceso.findMany({
          where: {
            empresaId,
            OR: [
              { codigoInterno: { contains: q } },
              { radicado: { contains: q } },
              { titulo: { contains: q } },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: POR_TIPO,
          select: { id: true, titulo: true, codigoInterno: true },
        });
        for (const p of procesos) {
          resultados.push({
            tipo: "proceso",
            id: p.id,
            titulo: p.titulo,
            subtitulo: p.codigoInterno,
          });
        }
      }

      if (await tienePermiso(req, "facturacion.factura.ver")) {
        const facturas = await prisma.factura.findMany({
          where: {
            empresaId,
            OR: [{ numero: { contains: q } }, { radicado: { contains: q } }],
          },
          orderBy: { createdAt: "desc" },
          take: POR_TIPO,
          select: { id: true, numero: true, cliente: { select: { nombre: true } } },
        });
        for (const f of facturas) {
          resultados.push({
            tipo: "factura",
            id: f.id,
            titulo: f.numero ?? "Factura (borrador)",
            subtitulo: f.cliente?.nombre ?? null,
          });
        }
      }

      // Equipo (usuarios de la empresa) y contratos: solo el admin de la empresa.
      if (req.esAdminEmpresa) {
        const equipo = await prisma.usuario.findMany({
          where: {
            empresaId,
            OR: [{ nombre: { contains: q } }, { email: { contains: q } }],
          },
          orderBy: { nombre: "asc" },
          take: POR_TIPO,
          select: { id: true, nombre: true, email: true },
        });
        for (const u of equipo) {
          resultados.push({ tipo: "usuario", id: u.id, titulo: u.nombre, subtitulo: u.email });
        }

        const contratos = await prisma.contrato.findMany({
          where: {
            empresaId,
            OR: [
              { nombreCompleto: { contains: q } },
              { numeroDocumento: { contains: q } },
              { cargo: { contains: q } },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: POR_TIPO,
          select: { id: true, nombreCompleto: true, cargo: true },
        });
        for (const c of contratos) {
          resultados.push({
            tipo: "contrato",
            id: c.id,
            titulo: c.nombreCompleto,
            subtitulo: c.cargo,
          });
        }
      }
    }

    res.json({ resultados });
  }),
);
