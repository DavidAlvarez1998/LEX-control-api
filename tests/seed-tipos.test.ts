import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTipoProcesoSchema } from "../src/modules/catalog/catalog.schemas";

type Tipo = { nombre: string; jurisdiccion: string; esquemaFormulario: unknown[]; etapas: any[] };
const tipos: Tipo[] = JSON.parse(
  readFileSync(join(__dirname, "../prisma/seed-tipos.json"), "utf-8"),
);

describe("seed-tipos.json", () => {
  it("todos los tipos sembrados pasan el Zod del catálogo (refs de campo válidas)", () => {
    const fallos = tipos
      .map((t) => ({ nombre: t.nombre, r: createTipoProcesoSchema.safeParse({ ...t, areaSlugs: (t as any).areaSlugs }) }))
      .filter((x) => !x.r.success)
      .map((x) => x.nombre);
    expect(fallos).toEqual([]);
  });

  it("siembra Derecho de Petición y Acción de Tutela (constitucional), sin duplicado", () => {
    const constit = tipos.filter((t) => t.jurisdiccion === "CONSTITUCIONAL").map((t) => t.nombre);
    expect(constit).toContain("Derecho de Petición");
    expect(constit).toContain("Acción de tutela");
    // Una sola tutela (no debe coexistir con la variante en mayúscula).
    expect(constit.filter((n) => n.toLowerCase() === "acción de tutela")).toHaveLength(1);
  });

  it("DdP radicada lleva el mapa de términos por tipo de petición (días hábiles)", () => {
    const ddp = tipos.find((t) => t.nombre === "Derecho de Petición")!;
    const radicada = ddp.etapas.find((e) => e.key === "radicada");
    expect(radicada.reglas.plazoTipoDias).toBe("habiles");
    expect(radicada.reglas.plazoDiasPorValorDe.mapa).toEqual({ General: 15, Documental: 10, Consulta: 30 });
  });

  it("DdP escala_tutela deriva hacia un tipo que existe en el catálogo", () => {
    const ddp = tipos.find((t) => t.nombre === "Derecho de Petición")!;
    const escala = ddp.etapas.find((e) => e.accion?.tipo === "crearDerivado");
    const destino = escala.accion.tipoDestinoNombre;
    expect(tipos.some((t) => t.nombre === destino)).toBe(true);
  });
});
