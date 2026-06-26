// Derivación de cartera/saldos COMPARTIDA entre el módulo contable (vista oficial
// de cartera) y el comercial (resumen de cobro en la ficha del cliente). Saldos
// DERIVADOS al leer, nunca guardados. Ver openspec/changes/comercial-rol-portal/.
import { Prisma, type EstadoPagoIngreso } from "@prisma/client";
import { prisma } from "../../index";

export const n = (d: Prisma.Decimal | null | undefined) => Number(d ?? 0);

/** valorPagado DERIVADO: por configuracionCobroId si existe, si no por (cliente, proceso). */
export async function valorPagado(c: {
  empresaId: string;
  configuracionCobroId: string | null;
  clienteId: string;
  procesoId: string | null;
}) {
  const where = c.configuracionCobroId
    ? { empresaId: c.empresaId, configuracionCobroId: c.configuracionCobroId, estadoPago: { in: ["PAGADO", "PARCIAL"] as EstadoPagoIngreso[] } }
    : { empresaId: c.empresaId, clienteId: c.clienteId, ...(c.procesoId ? { procesoId: c.procesoId } : {}), estadoPago: { in: ["PAGADO", "PARCIAL"] as EstadoPagoIngreso[] } };
  const agg = await prisma.ingreso.aggregate({ _sum: { valorRecibido: true }, where });
  return n(agg._sum.valorRecibido);
}

/** Adjunta valorPagado + saldoPendiente DERIVADOS a una fila de cartera. */
export const conSaldo = async (cartera: any) => {
  const pagado = await valorPagado(cartera);
  const total = cartera.valorTotalAcordado != null ? n(cartera.valorTotalAcordado) : null;
  return { ...cartera, valorPagado: pagado, saldoPendiente: total != null ? total - pagado : null };
};

/**
 * Versión en LOTE de `conSaldo`: en vez de un `aggregate` por fila (N+1), resuelve
 * todos los `valorPagado` con 2 `groupBy` (uno por `configuracionCobroId`, otro por
 * `(clienteId, procesoId)`), replicando la misma semántica que `valorPagado`:
 *  - con `configuracionCobroId` → suma por esa configuración;
 *  - sin ella y con `procesoId` → suma por (cliente, proceso);
 *  - sin ella y sin `procesoId` → suma TODO el cliente.
 */
export async function conSaldoBatch<T extends { empresaId: string; configuracionCobroId: string | null; clienteId: string; procesoId: string | null; valorTotalAcordado?: Prisma.Decimal | null }>(
  carteras: T[],
): Promise<Array<T & { valorPagado: number; saldoPendiente: number | null }>> {
  if (carteras.length === 0) return [];
  const empresaId = carteras[0].empresaId;
  const PAG = { in: ["PAGADO", "PARCIAL"] as EstadoPagoIngreso[] };

  const cfgIds = [...new Set(carteras.map((c) => c.configuracionCobroId).filter((x): x is string => !!x))];
  const cliIds = [...new Set(carteras.filter((c) => !c.configuracionCobroId).map((c) => c.clienteId))];

  const porCfg = new Map<string, number>();
  if (cfgIds.length) {
    const rows = await prisma.ingreso.groupBy({
      by: ["configuracionCobroId"],
      where: { empresaId, estadoPago: PAG, configuracionCobroId: { in: cfgIds } },
      _sum: { valorRecibido: true },
    });
    for (const r of rows) if (r.configuracionCobroId) porCfg.set(r.configuracionCobroId, n(r._sum.valorRecibido));
  }

  const key = (cli: string, proc: string | null) => `${cli}|${proc ?? ""}`;
  const porCliProc = new Map<string, number>();
  const porCliente = new Map<string, number>();
  if (cliIds.length) {
    const rows = await prisma.ingreso.groupBy({
      by: ["clienteId", "procesoId"],
      where: { empresaId, estadoPago: PAG, clienteId: { in: cliIds } },
      _sum: { valorRecibido: true },
    });
    for (const r of rows) {
      const v = n(r._sum.valorRecibido);
      porCliProc.set(key(r.clienteId, r.procesoId), v);
      porCliente.set(r.clienteId, (porCliente.get(r.clienteId) ?? 0) + v);
    }
  }

  return carteras.map((c) => {
    const pagado = c.configuracionCobroId
      ? porCfg.get(c.configuracionCobroId) ?? 0
      : c.procesoId
        ? porCliProc.get(key(c.clienteId, c.procesoId)) ?? 0
        : porCliente.get(c.clienteId) ?? 0;
    const total = c.valorTotalAcordado != null ? n(c.valorTotalAcordado) : null;
    return { ...c, valorPagado: pagado, saldoPendiente: total != null ? total - pagado : null };
  });
}
