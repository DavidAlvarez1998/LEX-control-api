// Tests del motor de etapas PURO (sin Express ni DB) — cumple el requisito de la
// spec api-architecture: "Engine is testable without HTTP or DB".
import { describe, expect, it } from "vitest";
import { siguienteEtapaAuto, terminalDecidido } from "../src/modules/procesos/maquina-etapas";
import type { EtapaDef } from "../src/modules/procesos/esquema";

const flujo: EtapaDef[] = [
  { key: "borrador", nombre: "Borrador", orden: 0 },
  { key: "radicada", nombre: "Radicación", orden: 1, reglas: { camposRequeridos: ["fechaRad"], documentosRequeridos: ["demanda.pdf"] } },
  { key: "respondida", nombre: "Respuesta", orden: 2, disponibleSi: { campo: "contestaron", igualA: ["SI", "NO", "PARCIAL"] } },
  { key: "reiterar", nombre: "Reiterar", orden: 3, disponibleSi: { campo: "contestaron", igualA: "PARCIAL" }, accion: { tipo: "crearDerivado", tipoDestinoNombre: "Otro" } },
  { key: "terminada", nombre: "Terminación", orden: 4, terminal: true },
  { key: "archivado", nombre: "Archivado", orden: 5, terminal: true, disponibleSi: { campo: "retiro", igualA: "SI" } },
];

describe("siguienteEtapaAuto", () => {
  it("avanza a la siguiente etapa cuando sus requisitos están listos", () => {
    const next = siguienteEtapaAuto(flujo, "borrador", { fechaRad: "2026-01-01" }, ["demanda.pdf"]);
    expect(next?.key).toBe("radicada");
  });

  it("NO avanza si faltan campos/documentos requeridos", () => {
    expect(siguienteEtapaAuto(flujo, "borrador", {}, [])).toBeNull();
    expect(siguienteEtapaAuto(flujo, "borrador", { fechaRad: "2026-01-01" }, [])).toBeNull(); // falta el doc
  });

  it("ESPERA (null) cuando la rama depende de un campo aún vacío", () => {
    // En radicada, la etapa 'respondida' depende de `contestaron` (sin decidir).
    expect(siguienteEtapaAuto(flujo, "radicada", {}, [])).toBeNull();
  });

  it("avanza por una rama disponible cuando el campo ya está decidido", () => {
    const next = siguienteEtapaAuto(flujo, "radicada", { contestaron: "SI" }, []);
    expect(next?.key).toBe("respondida");
  });

  it("salta niveles N/A definitivos hasta una etapa disponible (incl. terminal)", () => {
    // contestaron=SI: reiterar(PARCIAL) no aplica → salta a 'terminada'.
    const next = siguienteEtapaAuto(flujo, "respondida", { contestaron: "SI" }, []);
    expect(next?.key).toBe("terminada");
  });

  it("NO auto-avanza a una etapa con acción crearDerivado (decisión manual)", () => {
    const next = siguienteEtapaAuto(flujo, "respondida", { contestaron: "PARCIAL" }, []);
    expect(next).toBeNull();
  });

  it("NO auto-avanza si hay varias ramas disponibles (ambiguo)", () => {
    const ambiguo: EtapaDef[] = [
      { key: "a", nombre: "A", orden: 0 },
      { key: "b1", nombre: "B1", orden: 1, disponibleSi: { campo: "x", igualA: "SI" } },
      { key: "b2", nombre: "B2", orden: 1, disponibleSi: { campo: "y", igualA: "SI" } },
    ];
    expect(siguienteEtapaAuto(ambiguo, "a", { x: "SI", y: "SI" }, [])).toBeNull();
  });
});

describe("terminalDecidido", () => {
  it("salta al terminal decidido único por delante", () => {
    const next = terminalDecidido(flujo, "radicada", { retiro: "SI" }, []);
    expect(next?.key).toBe("archivado");
  });

  it("no salta si ningún terminal con disponibleSi se cumple", () => {
    expect(terminalDecidido(flujo, "radicada", {}, [])).toBeNull();
  });

  it("no salta si hay dos terminales en condición (ambiguo)", () => {
    const dos: EtapaDef[] = [
      { key: "a", nombre: "A", orden: 0 },
      { key: "t1", nombre: "T1", orden: 1, terminal: true, disponibleSi: { campo: "x", igualA: "SI" } },
      { key: "t2", nombre: "T2", orden: 2, terminal: true, disponibleSi: { campo: "y", igualA: "SI" } },
    ];
    expect(terminalDecidido(dos, "a", { x: "SI", y: "SI" }, [])).toBeNull();
  });
});
