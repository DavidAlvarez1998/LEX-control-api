import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { siguienteEtapaAuto, terminalDecidido } from "../src/modules/procesos/maquina-etapas";
import type { EtapaDef } from "../src/modules/procesos/esquema";

// Flujos de los procesos verbales civiles (CGP) reescritos FIEL a los documentos
// (openspec/changes/procesos-verbales-civil/doc-verbal*.md). Simula el auto-avance
// del motor sobre el seed real para garantizar que las ramas no se estancan.
const seed = JSON.parse(readFileSync(join(__dirname, "../prisma/seed-tipos.json"), "utf-8")) as Array<{
  nombre: string;
  etapas: EtapaDef[];
}>;
const tipo = (n: string) => seed.find((t) => t.nombre === n)!;

// Todos los documentos posibles presentes (para que el avance no se frene por docs).
const DOCS = [
  "demanda.pdf", "pruebas.pdf", "anexos.pdf", "soporte-radicacion.pdf", "poder.pdf",
  "subsanacion.pdf", "soporte-notificacion.pdf", "auto-admisorio.pdf", "contestacion.pdf",
  "reconvencion.pdf", "excepciones-merito.pdf", "acta-audiencia-inicial.pdf",
  "acta-audiencia-instruccion.pdf", "sentencia.pdf", "recurso.pdf", "sentencia-2inst.pdf",
  "acta-2inst.pdf", "acta-audiencia-unica.pdf",
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

describe("Proceso (declarativo) verbal — CGP (fiel al doc)", () => {
  const E = tipo("Proceso verbal").etapas;
  // Mínimo para crear + radicar (Fase 1) y llegar a calificación.
  const base = {
    calidad: "Demandante", sintesis: "x", fechaPresentacion: "2026-01-01", medioRadicacion: "Ventanilla",
    cuantia: "Mayor", unidadMedida: "Pesos", tipoPretension: "Indeterminadas",
    radicadoJudicial: "R1", juzgado: "Juzgado 1 Civil", solicitaMedidaCautelar: "No",
  };
  // Tras admisión: traslado, contestación y audiencia inicial fallida (sin conciliar).
  const hastaAudiencia = {
    estadoDemanda: "Admitida", demandadoNotificado: "Sí", trasladoFechaInicio: "2026-02-01",
    contesto: "Sí", aiEstado: "Realizada", aiConciliacion: "Fallida", aiSentenciaInmediata: "No",
  };

  it("admisión → audiencias → apela y concede → 2ª instancia → terminada", () => {
    const p = caminar(E, {
      ...base, ...hastaAudiencia, ajEstado: "Realizada", ajSentenciaOral: "Sí",
      sentenciaFecha: "2026-03-01", sentenciaTipo: "Oral", sentenciaResultado: "Favorable",
      recursoInterpuesto: "Sí", recursoTipo: "Apelación", apConcedido: "Sí",
      siResultado: "Confirma", siFechaSentencia2: "2026-05-01",
    });
    expect(p).toEqual(expect.arrayContaining(["radicacion", "calificacion", "traslado", "contestacion", "audienciaInicial", "audienciaInstruccion", "sentencia", "recurso", "segunda_instancia"]));
    expect(p.at(-1)).toBe("terminada");
  });

  it("sin apelar → termina sin 2ª instancia (no se estanca)", () => {
    const p = caminar(E, {
      ...base, ...hastaAudiencia, ajEstado: "Realizada", ajSentenciaOral: "Sí",
      sentenciaFecha: "2026-03-01", sentenciaTipo: "Oral", sentenciaResultado: "Favorable",
      recursoInterpuesto: "No",
    });
    expect(p).not.toContain("segunda_instancia");
    expect(p.at(-1)).toBe("terminada");
  });

  it("sentencia inmediata en audiencia inicial → salta la de instrucción", () => {
    const p = caminar(E, {
      ...base, estadoDemanda: "Admitida", demandadoNotificado: "Sí", trasladoFechaInicio: "2026-02-01",
      contesto: "Sí", aiEstado: "Realizada", aiConciliacion: "Fallida", aiSentenciaInmediata: "Sí",
      aiSentidoSentencia: "Favorable", sentenciaFecha: "2026-03-01", sentenciaTipo: "Oral",
      sentenciaResultado: "Favorable", recursoInterpuesto: "No",
    });
    expect(p).toContain("sentencia");
    expect(p).not.toContain("audienciaInstruccion");
    expect(p.at(-1)).toBe("terminada");
  });

  it("inadmitida → subsana → admisión → continúa a traslado", () => {
    const p = caminar(E, {
      ...base, estadoDemanda: "Inadmitida", inadmisionFechaNotif: "2026-01-05",
      subsanacionPresentada: "Sí", decisionTrasSubsanacion: "Admisión",
      demandadoNotificado: "Sí", trasladoFechaInicio: "2026-02-01", contesto: "Sí",
    });
    expect(p).toContain("subsanacion");
    expect(p).toContain("traslado");
  });

  it("inadmitida → NO subsana → archivo", () => {
    const p = caminar(E, { ...base, estadoDemanda: "Inadmitida", inadmisionFechaNotif: "2026-01-05", subsanacionPresentada: "No" });
    expect(p).toContain("subsanacion");
    expect(p.at(-1)).toBe("archivado_rechazo");
  });

  it("inadmitida → subsana → rechazo → recurso desfavorable → archivo", () => {
    const p = caminar(E, {
      ...base, estadoDemanda: "Inadmitida", inadmisionFechaNotif: "2026-01-05",
      subsanacionPresentada: "Sí", decisionTrasSubsanacion: "Rechazo",
      recursoTrasRechazo: "Sí", decisionRecursoTrasRechazo: "Desfavorable",
    });
    expect(p.indexOf("subsanacion")).toBeLessThan(p.indexOf("recurso_rechazo"));
    expect(p.at(-1)).toBe("archivado_rechazo");
  });

  it("rechazada → recurso favorable → continúa a traslado", () => {
    const p = caminar(E, {
      ...base, estadoDemanda: "Rechazada", rechazoFechaNotif: "2026-01-05",
      recursoRechazo: "Sí", recursoRechazoTipo: "Apelación", decisionRecursoRechazo: "Favorable",
      demandadoNotificado: "Sí", trasladoFechaInicio: "2026-02-01",
    });
    expect(p).toContain("recurso_rechazo");
    expect(p).toContain("traslado");
  });

  it("conciliación total en audiencia inicial → terminada_conciliacion (no llega a sentencia)", () => {
    const p = caminar(E, {
      ...base, estadoDemanda: "Admitida", demandadoNotificado: "Sí", trasladoFechaInicio: "2026-02-01",
      contesto: "Sí", aiEstado: "Realizada", aiConciliacion: "Total", aiSentenciaInmediata: "No",
    });
    expect(p.at(-1)).toBe("terminada_conciliacion");
    expect(p).not.toContain("audienciaInstruccion");
  });
});

describe("Proceso verbal sumario — CGP (única instancia, fiel al doc)", () => {
  const E = tipo("Proceso verbal sumario").etapas;
  const base = {
    calidad: "Demandante", demandaModo: "Verbal", sintesis: "x", fechaPresentacion: "2026-01-01",
    medioRadicacion: "Ventanilla", cuantia: "Mínima", unidadMedida: "SMMLV", tipoPretension: "Indeterminadas",
    esMinimaCuantia: "Sí", radicadoJudicial: "R1", juzgado: "Juzgado 1 Civil Municipal", solicitaMedidaCautelar: "No",
  };
  const hastaContestacion = {
    estadoDemanda: "Admitida", demandadoNotificado: "Sí", trasladoFechaInicio: "2026-02-01", contesto: "Sí",
  };

  it("audiencia única → sentencia EN FIRME → terminada (sin recurso ni 2ª instancia)", () => {
    const p = caminar(E, {
      ...base, ...hastaContestacion, sentenciaAnticipada: "No", auEstado: "Realizada", auConciliacion: "Fallida",
      sentenciaFecha: "2026-03-01", sentenciaTipo: "Oral", sentenciaResultado: "Favorable",
    });
    expect(p).toContain("audienciaUnica");
    expect(p).toContain("sentencia");
    expect(p).not.toContain("recurso");
    expect(p).not.toContain("segunda_instancia");
    expect(p.at(-1)).toBe("terminada");
  });

  it("sentencia anticipada (sin audiencia) → salta la audiencia única", () => {
    const p = caminar(E, {
      ...base, ...hastaContestacion, sentenciaAnticipada: "Sí",
      sentenciaFecha: "2026-03-01", sentenciaTipo: "Escrita", sentenciaResultado: "Favorable",
    });
    expect(p).not.toContain("audienciaUnica");
    expect(p).toContain("sentencia");
    expect(p.at(-1)).toBe("terminada");
  });

  it("conciliación total en audiencia única → terminada_conciliacion", () => {
    const p = caminar(E, {
      ...base, ...hastaContestacion, sentenciaAnticipada: "No", auEstado: "Realizada", auConciliacion: "Total",
    });
    expect(p.at(-1)).toBe("terminada_conciliacion");
  });

  it("rechazo en calificación → archivo", () => {
    const p = caminar(E, { ...base, estadoDemanda: "Rechazada", rechazoFechaNotif: "2026-01-05", recursoRechazo: "No" });
    expect(p.at(-1)).toBe("archivado_rechazo");
  });
});
