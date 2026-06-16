// Proveedor MOCK de actuaciones (Fase B). Los proveedores reales de actuaciones
// por radicado son CPNU (scrape, Fase C) y RUES (agregador de pago, Fase D), ambos
// bloqueados en este entorno (sin Redis/Playwright ni llaves). Este mock entrega
// actuaciones DETERMINISTAS derivadas del radicado, para ejercer el motor de
// sincronización end-to-end (idempotencia, proyección al timeline, logs) sin red.
//
// Determinista = el mismo radicado devuelve SIEMPRE las mismas actuaciones, así un
// re-sync produce itemsNew=0 (igual que un proveedor real estable).
import type { ActuacionDTO, ActuacionesProvider } from "./integraciones.types";

const FUENTE = "Mock CPNU (demo)";

// Plantilla fija de actuaciones de un proceso típico. La fecha se desplaza de
// forma estable según el radicado para que distintos procesos no colisionen.
const PLANTILLA: { actuacion: string; anotacion: string; diaOffset: number }[] = [
  { actuacion: "Auto admite demanda", anotacion: "Se admite la demanda y se ordena notificar.", diaOffset: 0 },
  { actuacion: "Notificación", anotacion: "Notificado el demandado por estado.", diaOffset: 5 },
  { actuacion: "Contestación de la demanda", anotacion: "El demandado contesta dentro del término.", diaOffset: 20 },
  { actuacion: "Fijación de audiencia", anotacion: "Se fija audiencia inicial (art. 372 CGP).", diaOffset: 35 },
];

/** Entero estable [0..n) derivado del radicado (hash simple, sin dependencias). */
function semilla(radicado: string): number {
  let h = 0;
  for (let i = 0; i < radicado.length; i++) h = (h * 31 + radicado.charCodeAt(i)) >>> 0;
  return h;
}

/** Fecha base estable a partir del radicado (rango ~2024-2025), formato ISO. */
function fechaBase(radicado: string): Date {
  const s = semilla(radicado);
  const base = Date.UTC(2024, 0, 1); // 2024-01-01
  return new Date(base + (s % 400) * 24 * 3600 * 1000);
}

async function fetchActuaciones(radicado: string): Promise<ActuacionDTO[]> {
  const base = fechaBase(radicado);
  return PLANTILLA.map((p) => {
    const f = new Date(base.getTime() + p.diaOffset * 24 * 3600 * 1000);
    return {
      fecha: f.toISOString().slice(0, 10), // YYYY-MM-DD
      actuacion: p.actuacion,
      anotacion: p.anotacion,
      fuente: FUENTE,
    };
  });
}

export const mockActuacionesAdapter: ActuacionesProvider = {
  nombre: FUENTE,
  mode: "scrape", // simula un proveedor de scrape (CPNU); nunca llama a la red
  fetchActuaciones,
};
