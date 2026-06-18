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
