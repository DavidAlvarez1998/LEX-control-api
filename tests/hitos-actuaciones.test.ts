// Tests de detección de HITOS (puro): mapea texto libre de actuaciones → sugerencia
// de avance de etapa, solo si la etapa/campo existen y el campo está vacío.
import { describe, expect, it } from "vitest";
import { detectarHitos, divergenciasRama } from "../src/modules/procesos/hitos-actuaciones";

const ETAPAS = [
  { key: "radicacionJuzgado", nombre: "Radicación en el juzgado" },
  { key: "calificacion", nombre: "Calificación" },
  { key: "mandamientoPago", nombre: "Mandamiento de pago" },
  { key: "terminacion", nombre: "Terminación" },
];
const ESQUEMA = [{ key: "fechaAdmision" }, { key: "decisionCalificacion" }, { key: "fechaMandamiento" }, { key: "fechaNotificacion" }, { key: "fechaTerminacion" }];

describe("detectarHitos", () => {
  it("'AUTO ADMITE LA DEMANDA' → calificacion + fechaAdmision + decisionCalificacion=Admite", () => {
    const s = detectarHitos([{ actuacion: "AUTO ADMITE LA DEMANDA", fechaActuacion: "2026-02-10T00:00:00" }], ETAPAS, ESQUEMA, {});
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ etapaKey: "calificacion", campoFecha: "fechaAdmision", fechaSugerida: "2026-02-10", campoValor: "decisionCalificacion", valorSugerido: "Admite" });
  });

  it("'INADMITE LA DEMANDA' → decisionCalificacion=Inadmite (INADMIT gana sobre ADMIT)", () => {
    const s = detectarHitos([{ actuacion: "AUTO INADMITE LA DEMANDA", fechaActuacion: "2026-02-12T00:00:00" }], ETAPAS, ESQUEMA, {});
    expect(s[0]).toMatchObject({ etapaKey: "calificacion", campoValor: "decisionCalificacion", valorSugerido: "Inadmite" });
  });

  it("no re-sugiere la decisión si decisionCalificacion ya está diligenciada (campoValor=null)", () => {
    const s = detectarHitos([{ actuacion: "AUTO ADMITE LA DEMANDA", fechaActuacion: "2026-02-10T00:00:00" }], ETAPAS, ESQUEMA, { decisionCalificacion: "Admite" });
    expect(s[0]).toMatchObject({ campoValor: null, valorSugerido: null });
  });

  it("'LIBRA MANDAMIENTO DE PAGO' → mandamientoPago/fechaMandamiento", () => {
    const s = detectarHitos([{ actuacion: "LIBRA MANDAMIENTO DE PAGO", fechaActuacion: "2026-03-01T00:00:00" }], ETAPAS, ESQUEMA, {});
    expect(s[0]).toMatchObject({ etapaKey: "mandamientoPago", campoFecha: "fechaMandamiento" });
  });

  it("matching difuso con tildes: 'Envió de Notificación' → fechaNotificacion", () => {
    const s = detectarHitos([{ actuacion: "Envió de Notificación", fechaActuacion: "2026-03-04T00:00:00" }], ETAPAS, ESQUEMA, {});
    expect(s[0]).toMatchObject({ etapaKey: "mandamientoPago", campoFecha: "fechaNotificacion" });
  });

  it("mandamiento + notificación → AMBAS fechas (una sugerencia por (etapa,campo))", () => {
    const s = detectarHitos(
      [
        { actuacion: "Notificación personal al demandado", fechaActuacion: "2026-03-05T00:00:00" },
        { actuacion: "LIBRA MANDAMIENTO DE PAGO", fechaActuacion: "2026-03-01T00:00:00" },
      ],
      ETAPAS, ESQUEMA, {},
    );
    const mando = s.filter((x) => x.etapaKey === "mandamientoPago");
    expect(mando).toHaveLength(2); // antes el dedup por etapa dejaba solo 1
    expect(mando.find((x) => x.campoFecha === "fechaMandamiento")?.fechaSugerida).toBe("2026-03-01");
    expect(mando.find((x) => x.campoFecha === "fechaNotificacion")?.fechaSugerida).toBe("2026-03-05");
  });

  it("dos actuaciones al MISMO campo → una sola sugerencia (la primera gana)", () => {
    const s = detectarHitos(
      [
        { actuacion: "AUTO INADMITE LA DEMANDA", fechaActuacion: "2026-02-12T00:00:00" },
        { actuacion: "AUTO ADMITE LA DEMANDA", fechaActuacion: "2026-02-10T00:00:00" },
      ],
      ETAPAS, ESQUEMA, {},
    );
    // ambas reglas apuntan a decisionCalificacion/fechaAdmision → colapsan; gana la 1ª
    expect(s.filter((x) => x.etapaKey === "calificacion")).toHaveLength(1);
    expect(s[0]).toMatchObject({ campoValor: "decisionCalificacion", valorSugerido: "Inadmite" });
  });

  it("no re-sugiere fecha si el campo ya está diligenciado (campoFecha=null)", () => {
    const s = detectarHitos([{ actuacion: "MANDAMIENTO DE PAGO", fechaActuacion: "2026-03-01T00:00:00" }], ETAPAS, ESQUEMA, { fechaMandamiento: "2026-03-01" });
    expect(s[0]).toMatchObject({ etapaKey: "mandamientoPago", campoFecha: null, fechaSugerida: null });
  });

  it("no sugiere etapas que el tipo no tiene; una sugerencia por etapa (la más reciente)", () => {
    const s = detectarHitos(
      [
        { actuacion: "AUTO ADMITE", fechaActuacion: "2026-02-10T00:00:00" },
        { actuacion: "INADMITE (segunda mención)", fechaActuacion: "2026-02-01T00:00:00" },
        { actuacion: "REMATE de bienes", fechaActuacion: "2026-05-01T00:00:00" }, // impulsos NO está en ETAPAS
      ],
      ETAPAS,
      ESQUEMA,
      {},
    );
    expect(s.filter((x) => x.etapaKey === "calificacion")).toHaveLength(1); // una sola
    expect(s.find((x) => x.etapaKey === "impulsos")).toBeUndefined(); // etapa ausente
  });
});

describe("divergenciasRama", () => {
  it("marca divergencia cuando la fecha cargada difiere de la de la Rama", () => {
    const d = divergenciasRama(
      [{ actuacion: "LIBRA MANDAMIENTO DE PAGO", fechaActuacion: "2026-03-15T00:00:00" }],
      ETAPAS, ESQUEMA, { fechaMandamiento: "2026-03-01" },
    );
    expect(d).toEqual([{ campo: "fechaMandamiento", fechaRama: "2026-03-15", fechaActual: "2026-03-01" }]);
  });

  it("no marca divergencia si coinciden, ni si el campo está vacío", () => {
    expect(divergenciasRama(
      [{ actuacion: "MANDAMIENTO DE PAGO", fechaActuacion: "2026-03-01T00:00:00" }],
      ETAPAS, ESQUEMA, { fechaMandamiento: "2026-03-01" },
    )).toHaveLength(0);
    expect(divergenciasRama(
      [{ actuacion: "MANDAMIENTO DE PAGO", fechaActuacion: "2026-03-01T00:00:00" }],
      ETAPAS, ESQUEMA, {},
    )).toHaveLength(0);
  });
});
