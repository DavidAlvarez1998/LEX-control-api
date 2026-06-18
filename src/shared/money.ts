// Conversión de dinero para serializar (Decimal de Prisma → number). Centraliza el
// helper `n()` que estaba duplicado en 5 módulos con firmas divergentes.
// OJO: para SUMAR/operar montos, hacerlo en Decimal (Prisma) y convertir al final;
// `Number` sobre Decimals grandes pierde precisión.
import type { Prisma } from "@prisma/client";

export function toNumber(d: Prisma.Decimal | number | null | undefined): number {
  return Number(d ?? 0);
}
