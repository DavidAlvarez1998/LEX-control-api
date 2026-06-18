import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluarCondicion, condicionPendiente, type EtapaDef } from "../src/modules/procesos/esquema";

// Carga el tipo "Proceso Laboral" del seed real.
const seed = JSON.parse(readFileSync(join(__dirname, "../prisma/seed-tipos.json"), "utf-8")) as Array<{
  nombre: string;
  etapas: EtapaDef[];
}>;
const laboral = seed.find((t) => t.nombre === "Proceso Laboral")!;
const etapas = laboral.etapas;

// Réplica fiel de `siguienteEtapaAuto` (procesos.router.ts): camina por niveles de
// `orden` ascendentes; en cada nivel filtra por `disponibleSi`; 0 disponibles con
// rama pendiente => espera (null); >1 => el usuario elige (null); 1 => avanza.
function siguiente(actualKey: string, datos: Record<string, unknown>): EtapaDef | null {
  const ordenActual = etapas.find((e) => e.key === actualKey)?.orden ?? -1;
  const ordenes = [...new Set(etapas.filter((e) => e.orden > ordenActual).map((e) => e.orden))].sort((a, b) => a - b);
  for (const orden of ordenes) {
    const nivel = etapas.filter((e) => e.orden === orden);
    const disp = nivel.filter((e) => !e.disponibleSi || evaluarCondicion(e.disponibleSi, datos));
    if (disp.length === 0) {
      if (nivel.some((e) => e.disponibleSi && condicionPendiente(e.disponibleSi, datos))) return null;
      continue;
    }
    if (disp.length > 1) return { __ambiguo: disp.map((e) => e.key) } as unknown as EtapaDef;
    return disp[0];
  }
  return null;
}

// Camina desde `presentacion` hasta un terminal con `datos` completos.
function caminar(datos: Record<string, unknown>): string[] {
  const path = ["presentacion"];
  let actual = "presentacion";
  for (let i = 0; i < 50; i++) {
    const next = siguiente(actual, datos);
    if (!next) break;
    expect((next as { __ambiguo?: string[] }).__ambiguo, `nivel ambiguo tras ${actual}`).toBeUndefined();
    path.push(next.key);
    if (next.terminal) break;
    actual = next.key;
  }
  return path;
}

const base = { rol: "Demandante", tipoInstancia: "Doble instancia", hayRetiro: "NO", conciliaResultado: "NO" };

describe("Proceso Laboral — los 4 flujos caminan y terminan", () => {
  it("Demandante/Única: admisión directa, sin recurso → audiencia única → terminada", () => {
    const p = caminar({ rol: "Demandante", tipoInstancia: "Única instancia", decisionAuto: "ADMISIÓN", hayRetiro: "NO", conciliaResultado: "NO", hayRecurso: "NO" });
    expect(p).toContain("admision");
    expect(p).toContain("citacionAudiencia");
    expect(p.indexOf("citacionAudiencia")).toBeLessThan(p.indexOf("preparacionAudiencia")); // única: citación antes
    expect(p).toContain("audienciaUnica");
    expect(p).not.toContain("contestacion");
    expect(p).not.toContain("audienciaArt77");
    expect(p).not.toContain("remision2inst");
    expect(p.at(-1)).toBe("terminada");
  });

  it("Demandante/Doble: admisión directa, apela y se concede → 2ª instancia → terminada", () => {
    const p = caminar({ ...base, decisionAuto: "ADMISIÓN", contestaron: "SI", hayRecurso: "SI", concedeApelacion: "SI" });
    expect(p).toContain("contestacion");
    expect(p.indexOf("preparacionAudiencia_doble")).toBeLessThan(p.indexOf("citacionAudiencia_doble")); // doble: preparación antes
    expect(p).toContain("audienciaArt77");
    expect(p).toContain("audienciaArt80");
    expect(p).toEqual(expect.arrayContaining(["remision2inst", "sustentacion2inst", "audiencia2inst", "sentencia2inst"]));
    expect(p.at(-1)).toBe("terminada");
  });

  it("Demandante/Doble: INADMISIÓN → subsanar → RECHAZAR → recurso DESFAVORABLE → archivo", () => {
    const p = caminar({ ...base, decisionAuto: "INADMISIÓN", decisionTrasSubsanacion: "RECHAZAR", recursoRechazo: "REPOSICIÓN", decisionRecursoRechazo: "DESFAVORABLE" });
    expect(p.indexOf("subsanacion")).toBeLessThan(p.indexOf("recurso_rechazo")); // recurso alcanzable tras subsanar
    expect(p).toContain("recurso_rechazo");
    expect(p.at(-1)).toBe("archivado_rechazo");
  });

  it("Demandante/Doble: INADMISIÓN → subsanar → ADMITIR → continúa el proceso", () => {
    const p = caminar({ ...base, decisionAuto: "INADMISIÓN", decisionTrasSubsanacion: "ADMITIR", contestaron: "SI", hayRecurso: "NO" });
    expect(p).toContain("subsanacion");
    expect(p).toContain("traslado");
    expect(p).toContain("contestacion");
    expect(p).not.toContain("archivado_rechazo");
    expect(p.at(-1)).toBe("terminada");
  });

  it("Demandante/Doble: RECHAZO directo → recurso FAVORABLE → continúa (no archiva)", () => {
    const p = caminar({ ...base, decisionAuto: "RECHAZO", recursoRechazo: "APELACIÓN", decisionRecursoRechazo: "FAVORABLE", hayRecurso: "NO" });
    expect(p).toContain("recurso_rechazo");
    expect(p).not.toContain("archivado_rechazo");
    expect(p).toContain("traslado");
    expect(p.at(-1)).toBe("terminada");
  });

  it("Demandante/Doble: hayRecurso=NO → termina sin 2ª instancia (sin estancarse)", () => {
    const p = caminar({ ...base, decisionAuto: "ADMISIÓN", contestaron: "SI", hayRecurso: "NO" });
    expect(p).not.toContain("remision2inst");
    expect(p.at(-1)).toBe("terminada");
  });

  it("Demandado/Única: sin admisión, sin contestación, sin 2ª instancia → terminada", () => {
    const p = caminar({ rol: "Demandado", tipoInstancia: "Única instancia", hayRetiro: "NO", conciliaResultado: "NO", hayRecurso: "NO" });
    expect(p).not.toContain("admision");
    expect(p).not.toContain("contestacion");
    expect(p).not.toContain("remision2inst");
    expect(p).toContain("audienciaUnica");
    expect(p.at(-1)).toBe("terminada");
  });

  it("Demandado/Doble: admisión (registro), contestación, 2ª instancia → terminada", () => {
    const p = caminar({ rol: "Demandado", tipoInstancia: "Doble instancia", hayRetiro: "NO", contestaron: "SI", conciliaResultado: "NO", hayRecurso: "SI", concedeApelacion: "SI" });
    expect(p).toContain("admision");
    expect(p).toContain("contestacion");
    expect(p.indexOf("preparacionAudiencia_doble")).toBeLessThan(p.indexOf("citacionAudiencia_doble"));
    expect(p).toContain("sentencia2inst");
    expect(p.at(-1)).toBe("terminada");
  });

  it("Retiro art. 67 → archivado", () => {
    const p = caminar({ ...base, decisionAuto: "ADMISIÓN", hayRetiro: "SI" });
    expect(p.at(-1)).toBe("archivado");
  });

  it("Conciliación en audiencia (doble) → terminada_conciliacion (no sigue a sentencia)", () => {
    const p = caminar({ ...base, decisionAuto: "ADMISIÓN", contestaron: "SI", conciliaResultado: "SI" });
    expect(p.at(-1)).toBe("terminada_conciliacion");
    expect(p).not.toContain("audienciaArt80");
    expect(p).not.toContain("recurso");
  });

  it("Conciliación en audiencia (única) → terminada_conciliacion", () => {
    const p = caminar({ rol: "Demandante", tipoInstancia: "Única instancia", decisionAuto: "ADMISIÓN", hayRetiro: "NO", conciliaResultado: "SI" });
    expect(p.at(-1)).toBe("terminada_conciliacion");
  });
});
