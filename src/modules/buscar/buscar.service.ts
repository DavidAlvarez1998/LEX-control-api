// Búsqueda global consciente del rol. Staff de plataforma (ADMIN/COMERCIAL) ve
// prospectos/empresas/planes/usuarios; el usuario de despacho ve clientes/procesos/
// facturas SOLO con el permiso (callback `can`) y acotado a su empresa; el admin de
// empresa además ve equipo/contratos. Sin Express (recibe TenantContext + `can`).
import { Rol } from "@prisma/client";
import type { TenantContext } from "../../shared/tenant";
import { BuscarRepository } from "./buscar.repository";
import type { Resultado } from "./buscar.dto";

const MIN_Q = 2;

export async function buscar(
  t: TenantContext,
  q: string,
  can: (permiso: string) => Promise<boolean>,
): Promise<{ resultados: Resultado[] }> {
  if (q.length < MIN_Q) return { resultados: [] };

  const repo = new BuscarRepository();
  const resultados: Resultado[] = [];

  if (t.rol === Rol.ADMIN || t.rol === Rol.COMERCIAL) {
    const prospectos = await repo.prospectos(q, t.rol === Rol.COMERCIAL ? t.userId : undefined);
    for (const p of prospectos) {
      resultados.push({ tipo: "prospecto", id: p.id, titulo: p.nombreEmpresa, subtitulo: p.nombreContacto });
    }

    if (t.rol === Rol.ADMIN) {
      for (const e of await repo.empresas(q)) {
        resultados.push({ tipo: "empresa", id: e.id, titulo: e.nombre, subtitulo: e.rfc ? `NIT ${e.rfc}` : null });
      }
      for (const pl of await repo.planes(q)) {
        resultados.push({ tipo: "plan", id: pl.id, titulo: pl.nombre, subtitulo: pl.clave });
      }
      for (const u of await repo.usuariosPlataforma(q)) {
        resultados.push({ tipo: "usuario", id: u.id, titulo: u.nombre, subtitulo: u.email });
      }
    }
  } else if (t.empresaId) {
    const empresaId = t.empresaId;

    if (await can("cliente.ver")) {
      for (const c of await repo.clientes(empresaId, q)) {
        resultados.push({ tipo: "cliente", id: c.id, titulo: c.nombre, subtitulo: c.numeroDocumento ? `CC ${c.numeroDocumento}` : null });
      }
    }
    if (await can("proceso.ver")) {
      for (const p of await repo.procesos(empresaId, q)) {
        resultados.push({ tipo: "proceso", id: p.id, titulo: p.titulo, subtitulo: p.codigoInterno });
      }
    }
    if (await can("facturacion.factura.ver")) {
      for (const f of await repo.facturas(empresaId, q)) {
        resultados.push({ tipo: "factura", id: f.id, titulo: f.numero ?? "Factura (borrador)", subtitulo: f.cliente?.nombre ?? null });
      }
    }
    // Equipo y contratos: solo el admin de la empresa.
    if (t.esAdminEmpresa) {
      for (const u of await repo.equipo(empresaId, q)) {
        resultados.push({ tipo: "usuario", id: u.id, titulo: u.nombre, subtitulo: u.email });
      }
      for (const c of await repo.contratos(empresaId, q)) {
        resultados.push({ tipo: "contrato", id: c.id, titulo: c.nombreCompleto, subtitulo: c.cargo });
      }
    }
  }

  return { resultados };
}
