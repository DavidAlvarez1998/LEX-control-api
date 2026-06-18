import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { siguienteEtapaAuto, terminalDecidido } from "../src/modules/procesos/maquina-etapas";
import type { EtapaDef } from "../src/modules/procesos/esquema";

const seed = JSON.parse(readFileSync(join(__dirname, "../prisma/seed-tipos.json"), "utf-8")) as Array<{
  nombre: string;
  etapas: EtapaDef[];
}>;
const tipo = (n: string) => seed.find((t) => t.nombre === n)!;

// Todos los documentos posibles presentes (para que el avance no se frene por docs).
const DOCS = [
  "demanda.pdf", "pruebas.pdf", "anexos.pdf", "poder.pdf", "auto-calificacion.pdf", "subsanacion.pdf",
  "auto-admision-tras-subsanacion.pdf", "notificacion.pdf", "contestacion.pdf", "auto-silencio.pdf",
  "reconvencion.pdf", "acta-art372.pdf", "sentencia.pdf", "acta-art373.pdf", "recurso.pdf",
  "escrito-sustentacion.pdf", "auto-2inst.pdf", "acta-2inst.pdf", "sentencia-2inst.pdf", "acta-audiencia.pdf",
];

function caminar(etapas: EtapaDef[], datos: Record<string, unknown>): string[] {
  const path = ["presentacion"];
  let actual = "presentacion";
  for (let i = 0; i < 50; i++) {
    const next = siguienteEtapaAuto(etapas, actual, datos, DOCS) ?? terminalDecidido(etapas, actual, datos, DOCS);
    if (!next) break;
    path.push(next.key);
    if (next.terminal) break;
    actual = next.key;
  }
  return path;
}

describe("Proceso (declarativo) verbal — CGP", () => {
  const E = tipo("Proceso verbal").etapas;
  const base = { rol: "Demandante", pretensiones: "x", cuantia: 1, hayRetiro: "NO", fechaNotificacion: "2026-02-01", conciliaResultado: "NO" };

  it("Demandante: admisión → audiencias → apela y concede → 2ª instancia → terminada", () => {
    const p = caminar(E, { ...base, decisionAuto: "ADMISIÓN", fechaAuto: "2026-01-01", contestaron: "SI", fechaSentencia: "2026-03-01", decisionSentencia: "FAVORABLE", hayRecurso: "SI", concedeApelacion: "SI", fechaRemision2inst: "2026-04-01", radicado2inst: "x", fechaSustentacion: "2026-04-05", fechaAudiencia2inst: "2026-05-01", fechaSentencia2inst: "2026-05-10", decisionSegundaInstancia: "CONFIRMA" });
    expect(p).toContain("calificacion");
    expect(p).toContain("audienciaInicial");
    expect(p).toContain("audienciaInstruccion");
    expect(p).toEqual(expect.arrayContaining(["remision2inst", "sustentacion2inst", "audiencia2inst", "sentencia2inst"]));
    expect(p.at(-1)).toBe("terminada");
  });

  it("Demandante: sin apelar → termina sin 2ª instancia (no se estanca)", () => {
    const p = caminar(E, { ...base, decisionAuto: "ADMISIÓN", fechaAuto: "2026-01-01", contestaron: "SI", fechaSentencia: "2026-03-01", decisionSentencia: "FAVORABLE", hayRecurso: "NO" });
    expect(p).not.toContain("remision2inst");
    expect(p.at(-1)).toBe("terminada");
  });

  it("INADMISIÓN → subsanar → RECHAZAR → recurso DESFAVORABLE → archivo", () => {
    const p = caminar(E, { ...base, decisionAuto: "INADMISIÓN", fechaAuto: "2026-01-01", decisionTrasSubsanacion: "RECHAZAR", fechaSubsanacion: "2026-01-08", recursoRechazo: "APELACIÓN", fechaRecursoRechazo: "2026-01-10", decisionRecursoRechazo: "DESFAVORABLE" });
    expect(p.indexOf("subsanacion")).toBeLessThan(p.indexOf("recurso_rechazo"));
    expect(p.at(-1)).toBe("archivado_rechazo");
  });

  it("Conciliación en audiencia inicial → terminada_conciliacion (no llega a sentencia)", () => {
    const p = caminar(E, { ...base, decisionAuto: "ADMISIÓN", fechaAuto: "2026-01-01", contestaron: "SI", conciliaResultado: "SI" });
    expect(p.at(-1)).toBe("terminada_conciliacion");
    expect(p).not.toContain("audienciaInstruccion");
  });

  it("Retiro → archivado", () => {
    const p = caminar(E, { ...base, decisionAuto: "ADMISIÓN", fechaAuto: "2026-01-01", hayRetiro: "SI" });
    expect(p.at(-1)).toBe("archivado");
  });
});

describe("Proceso verbal sumario — CGP (única instancia)", () => {
  const E = tipo("Proceso verbal sumario").etapas;
  const base = { asuntoNaturaleza: "Mínima cuantía", pretensiones: "x", hayRetiro: "NO", fechaNotificacion: "2026-02-01" };

  it("Única instancia: audiencia única → sentencia EN FIRME → terminada (sin recurso ni 2ª inst.)", () => {
    const p = caminar(E, { ...base, decisionAuto: "ADMISIÓN", fechaAuto: "2026-01-01", contestaron: "SI", conciliaResultado: "NO", fechaSentencia: "2026-03-01", decisionSentencia: "FAVORABLE" });
    expect(p).toContain("audienciaUnica");
    expect(p).not.toContain("recurso");
    expect(p).not.toContain("remision2inst");
    expect(p.at(-1)).toBe("terminada");
  });

  it("Conciliación → terminada_conciliacion", () => {
    const p = caminar(E, { ...base, decisionAuto: "ADMISIÓN", fechaAuto: "2026-01-01", contestaron: "SI", conciliaResultado: "SI" });
    expect(p.at(-1)).toBe("terminada_conciliacion");
  });

  it("RECHAZO en calificación → archivo", () => {
    const p = caminar(E, { ...base, decisionAuto: "RECHAZO", fechaAuto: "2026-01-01" });
    expect(p.at(-1)).toBe("archivado_rechazo");
  });
});
