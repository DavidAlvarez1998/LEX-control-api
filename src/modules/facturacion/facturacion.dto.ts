// Derivaciones puras de Facturación: estado de pago, saldo y ensamblado de la
// respuesta (pagado/saldo/estadoPago se DERIVAN al leer, nunca se guardan).
import type { Prisma } from "@prisma/client";

export const n = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);
export const EPS = 0.005; // tolerancia para comparar dinero (Decimal 2 decimales)

export function estadoPagoDerivado(
  f: { estado: string; total: Prisma.Decimal | number; fechaVencimiento: Date | null },
  pagado: number,
): string {
  if (f.estado === "ANULADA") return "ANULADA";
  if (f.estado === "BORRADOR") return "BORRADOR";
  const total = n(f.total);
  if (total > 0 && pagado >= total - EPS) return "PAGADA";
  if (pagado > 0) return "PARCIAL";
  if (f.fechaVencimiento && f.fechaVencimiento.getTime() < Date.now()) return "VENCIDA";
  return "PENDIENTE";
}

/** Ensambla la factura con pagado/saldo/estadoPago a partir del `pagado` ya calculado. */
export function withEstado<
  T extends { total: Prisma.Decimal; estado: string; fechaVencimiento: Date | null },
>(f: T, pagado: number) {
  return { ...f, pagado, saldo: n(f.total) - pagado, estadoPago: estadoPagoDerivado(f, pagado) };
}
