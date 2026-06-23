import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { siguienteEtapaAuto, terminalDecidido } from "../src/modules/procesos/maquina-etapas";
import type { EtapaDef } from "../src/modules/procesos/esquema";

// Flujo del ejecutivo de mínima cuantía sobre el seed real: foco en la bifurcación
// tras la audiencia (sentencia de excepciones). Ver openspec/changes/
// proceso-ejecutivo-minima-cuantia/addendum-excepciones-prosperan.md.
const seed = JSON.parse(readFileSync(join(__dirname, "../prisma/seed-tipos.json"), "utf-8")) as Array<{
  nombre: string;
  etapas: EtapaDef[];
}>;
const E = seed.find((t) => t.nombre === "Proceso ejecutivo de mínima cuantía")!.etapas;

// Todos los docs presentes para que el avance no se frene por documentos.
const DOCS = ["liquidacion-credito.pdf", "avaluo.pdf", "acta-remate.pdf", "auto-terminacion.pdf"];

const sig = (actual: string, datos: Record<string, unknown>) =>
  (siguienteEtapaAuto(E, actual, datos, DOCS) ?? terminalDecidido(E, actual, datos, DOCS))?.key ?? null;

describe("Ejecutivo mínima cuantía — bifurcación de excepciones (art. 392)", () => {
  it("excepciones PROSPERAN → termina a favor del demandado (terminal)", () => {
    expect(sig("audiencia", { contesto: "Sí", sentenciaExcepciones: "Prosperan" })).toBe("terminado_excepciones");
  });

  it("excepciones NO prosperan → sigue la ejecución (Impulsos)", () => {
    expect(
      sig("audiencia", { contesto: "Sí", sentenciaExcepciones: "No prosperan", descripcionImpulso: "oficio", continuaARemate: "Sí" }),
    ).toBe("impulsos");
  });

  it("el demandado NO contestó → salta la audiencia y sigue a Impulsos", () => {
    expect(
      sig("mandamientoPago", { contesto: "No", descripcionImpulso: "oficio", continuaARemate: "Sí" }),
    ).toBe("impulsos");
  });

  it("Impulsos es N/A cuando las excepciones prosperan (no se transita)", () => {
    // Aun con los campos de impulsos llenos, prosperar manda al terminal, no a impulsos.
    expect(
      sig("audiencia", { contesto: "Sí", sentenciaExcepciones: "Prosperan", descripcionImpulso: "x", continuaARemate: "Sí" }),
    ).toBe("terminado_excepciones");
  });
});
