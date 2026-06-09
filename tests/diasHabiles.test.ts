import { describe, expect, it } from "vitest";
import {
  esDiaHabil,
  festivosColombia,
  sumarDiasCalendario,
  sumarDiasHabiles,
} from "../src/modules/procesos/diasHabiles";

/** Fecha UTC desde año/mes(1-12)/día. */
const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
const iso = (date: Date) => date.toISOString().slice(0, 10);

describe("festivosColombia", () => {
  it("2024: set exacto de 18 festivos (ancla dorada)", () => {
    const esperado = [
      "2024-01-01", // Año Nuevo
      "2024-01-08", // Reyes (Emiliani, de Ene 6 sáb)
      "2024-03-25", // San José (Emiliani, de Mar 19 mar)
      "2024-03-28", // Jueves Santo
      "2024-03-29", // Viernes Santo
      "2024-05-01", // Trabajo
      "2024-05-13", // Ascensión (Pascua +43)
      "2024-06-03", // Corpus Christi (Pascua +64)
      "2024-06-10", // Sagrado Corazón (Pascua +71)
      "2024-07-01", // San Pedro y San Pablo (Emiliani, de Jun 29 sáb)
      "2024-07-20", // Independencia
      "2024-08-07", // Batalla de Boyacá
      "2024-08-19", // Asunción (Emiliani, de Ago 15 jue)
      "2024-10-14", // Día de la Raza (Emiliani, de Oct 12 sáb)
      "2024-11-04", // Todos los Santos (Emiliani, de Nov 1 vie)
      "2024-11-11", // Independencia de Cartagena (ya es lunes)
      "2024-12-08", // Inmaculada Concepción
      "2024-12-25", // Navidad
    ];
    expect([...festivosColombia(2024)].sort()).toEqual(esperado);
  });

  // Festivos relativos a la Pascua, deterministas por año (Pascua: 2024-03-31,
  // 2025-04-20, 2026-04-05, 2027-03-28). Aquí es donde se esconden los errores.
  const pascuales: Record<number, string[]> = {
    2024: ["2024-03-28", "2024-03-29", "2024-05-13", "2024-06-03", "2024-06-10"],
    2025: ["2025-04-17", "2025-04-18", "2025-06-02", "2025-06-23", "2025-06-30"],
    2026: ["2026-04-02", "2026-04-03", "2026-05-18", "2026-06-08", "2026-06-15"],
    2027: ["2027-03-25", "2027-03-26", "2027-05-10", "2027-05-31", "2027-06-07"],
  };
  for (const [year, dias] of Object.entries(pascuales)) {
    it(`${year}: festivos pascuales (Jueves/Viernes Santo, Ascensión, Corpus, Sagrado Corazón)`, () => {
      const set = festivosColombia(Number(year));
      for (const dia of dias) expect(set.has(dia)).toBe(true);
    });
  }

  for (const year of [2024, 2025, 2026, 2027]) {
    it(`${year}: fijos presentes y Emiliani siempre en lunes`, () => {
      const set = festivosColombia(year);
      for (const fijo of [`${year}-01-01`, `${year}-05-01`, `${year}-07-20`, `${year}-08-07`, `${year}-12-08`, `${year}-12-25`]) {
        expect(set.has(fijo)).toBe(true);
      }
      // Reyes/San José/San Pedro/Asunción/Raza/Todos los Santos/Cartagena → lunes.
      const emiliani = [d(year, 1, 6), d(year, 3, 19), d(year, 6, 29), d(year, 8, 15), d(year, 10, 12), d(year, 11, 1), d(year, 11, 11)];
      for (const base of emiliani) {
        const lunes = [...set].find((s) => {
          const f = new Date(`${s}T00:00:00Z`);
          return f >= base && f.getUTCDay() === 1 && f.getTime() - base.getTime() <= 6 * 86400000;
        });
        expect(lunes, `Emiliani de ${iso(base)} debe caer en un lunes`).toBeDefined();
      }
    });
  }
});

describe("esDiaHabil", () => {
  it("sábado y domingo no son hábiles", () => {
    expect(esDiaHabil(d(2026, 2, 7))).toBe(false); // sábado
    expect(esDiaHabil(d(2026, 2, 8))).toBe(false); // domingo
  });
  it("un festivo no es hábil", () => {
    expect(esDiaHabil(d(2026, 1, 1))).toBe(false); // Año Nuevo
  });
  it("un miércoles normal sí es hábil", () => {
    expect(esDiaHabil(d(2026, 2, 4))).toBe(true);
  });
});

describe("sumarDiasHabiles", () => {
  it("derecho de petición documental: radicación + 10 días hábiles", () => {
    // 2026-02-02 (lunes) + 10 hábiles, sin festivos en el tramo → 2026-02-16 (lunes).
    expect(iso(sumarDiasHabiles(d(2026, 2, 2), 10))).toBe("2026-02-16");
  });
  it("salta el festivo de Año Nuevo", () => {
    // 2025-12-31 (mié) + 1 hábil → salta Ene 1 (festivo) → 2026-01-02 (vie).
    expect(iso(sumarDiasHabiles(d(2025, 12, 31), 1))).toBe("2026-01-02");
  });
  it("n <= 0 devuelve la misma fecha", () => {
    expect(iso(sumarDiasHabiles(d(2026, 2, 2), 0))).toBe("2026-02-02");
  });
});

describe("sumarDiasCalendario", () => {
  it("suma días corridos (incluye fines de semana)", () => {
    expect(iso(sumarDiasCalendario(d(2026, 2, 2), 10))).toBe("2026-02-12");
  });
});
