/** Smoke del Proceso Laboral (change laboral-doble-instancia):
 *  A) Seed vivo: campos/etapas nuevos presentes en BD.
 *  B) Camina DEMANDANTE·DOBLE completo por la API hasta 2ª instancia → terminada.
 *  C) Gating de las correcciones: recurso tras subsanar, demandado sin subsanación,
 *     2ª instancia solo en doble con apelación concedida.
 *  Correr: pnpm exec tsx scripts/smoke-laboral-flujo.ts */
import request from "supertest";
import { prisma } from "../src/index";
import { createApp } from "../src/app";
import { hashPassword, signToken } from "../src/modules/auth/auth.service";
import type { EtapaDef, CampoEsquema } from "../src/modules/procesos/esquema";

const RFC = "SMOKE-LABORAL";
const app = createApp();
const PASS = "Smoke123!";
let ok = 0, fail = 0;
const log = (s: string) => console.log("  " + s);
function check(cond: boolean, label: string, extra = "") {
  cond ? ok++ : fail++;
  log(`${cond ? "✓" : "✗ FALLO"} ${label}${extra ? " · " + extra : ""}`);
}

async function limpiar() {
  const e = await prisma.empresa.findUnique({ where: { rfc: RFC }, select: { id: true } });
  if (!e) return;
  await prisma.proceso.deleteMany({ where: { empresaId: e.id } });
  await prisma.cliente.deleteMany({ where: { empresaId: e.id } });
  await prisma.usuario.deleteMany({ where: { empresaId: e.id } });
  await prisma.empresa.delete({ where: { id: e.id } });
}

async function main() {
  await limpiar();
  const tipo = await prisma.tipoProceso.findFirstOrThrow({ where: { empresaId: null, nombre: "Proceso Laboral" } });
  const esquema = tipo.esquemaFormulario as unknown as CampoEsquema[];
  const etapas = tipo.etapas as unknown as EtapaDef[];
  const has = (k: string) => esquema.some((c) => c.key === k);
  const etapa = (k: string) => etapas.find((e) => e.key === k);

  console.log("\n── Smoke PROCESO LABORAL ──\n");

  // ===== A) SEED VIVO =====
  console.log("A) Seed vivo (BD)\n");
  for (const k of ["fechaAdmisionTrasSubsanacion", "concedeApelacion", "fechaRemision2inst", "radicado2inst", "fechaSustentacion", "fechaAudiencia2inst", "fechaSentencia2inst", "decisionSegundaInstancia"])
    check(has(k), `campo nuevo presente: ${k}`);
  for (const k of ["preparacionAudiencia_doble", "citacionAudiencia_doble", "remision2inst", "sustentacion2inst", "audiencia2inst", "sentencia2inst"])
    check(!!etapa(k), `etapa nueva presente: ${k}`);
  check(etapa("preparacionAudiencia_doble")!.orden < etapa("citacionAudiencia_doble")!.orden, "doble: preparación antes que citación");
  check(etapa("citacionAudiencia")!.orden < etapa("preparacionAudiencia")!.orden, "única: citación antes que preparación");
  check(etapa("recurso_rechazo")!.orden > etapa("subsanacion")!.orden, "recurso_rechazo alcanzable tras subsanación (orden mayor)");
  check(etapas.every((e) => typeof e.fase === "number"), "todas las etapas tienen `fase`");

  // ===== Setup común =====
  const empresa = await prisma.empresa.create({ data: { nombre: "SMOKE Laboral", rfc: RFC, activo: true } });
  const admin = await prisma.usuario.create({ data: { email: "admin@smoke-laboral.local", nombre: "Admin", password: await hashPassword(PASS), rol: "USUARIO", empresaId: empresa.id, esAdminEmpresa: true } });
  const cliente = await prisma.cliente.create({ data: { empresaId: empresa.id, nombre: "Trabajador Uno", estado: "CLIENTE" } });
  const auth = { Authorization: `Bearer ${signToken({ sub: admin.id, rol: "USUARIO", tv: admin.tokenVersion })}` };

  async function crear(codigo: string, datos: Record<string, unknown>, docs: string[]) {
    const p = await prisma.proceso.create({
      data: {
        empresaId: empresa.id, tipoProcesoId: tipo.id, tipoEsquemaVersion: tipo.esquemaVersion,
        jurisdiccion: tipo.jurisdiccion, codigoInterno: codigo, titulo: `Laboral ${codigo}`,
        clienteId: cliente.id, creadoPorId: admin.id, etapaActual: "presentacion", datos,
        historial: { create: { etapaKey: "presentacion", usuarioId: admin.id } },
      },
    });
    for (const d of docs) await prisma.documentoProceso.create({ data: { procesoId: p.id, nombre: d, url: `http://x/${d}` } });
    return p;
  }
  const patch = (id: string, etapaKey: string) => request(app).patch(`/procesos/${id}/etapa`).set(auth).send({ etapaKey });

  // ===== B) DEMANDANTE·DOBLE — camino completo hasta 2ª instancia =====
  console.log("\nB) Demandante·Doble → 2ª instancia → terminada\n");
  const datosDoble = {
    rol: "Demandante", tipoInstancia: "Doble instancia",
    decisionAuto: "ADMISIÓN", fechaAdmision: "2026-06-01", hayRetiro: "NO",
    fechaNotificacion: "2026-06-02", contestaron: "SI", fechaContestacion: "2026-06-09",
    conciliable: "SI", fechaAudiencia: "2026-06-15", conciliaResultado: "NO",
    fechaSentencia: "2026-06-20", decisionSentencia: "FAVORABLE",
    hayRecurso: "SI", formaRecurso: "POR ESCRITO (3 DÍAS)", decisionRecurso: "FAVORABLE", concedeApelacion: "SI",
    fechaRemision2inst: "2026-07-01", radicado2inst: "11001-2026-002", fechaSustentacion: "2026-07-05",
    fechaAudiencia2inst: "2026-07-20", fechaSentencia2inst: "2026-07-25", decisionSegundaInstancia: "CONFIRMA",
  };
  const dDoble = await crear("LAB-DOBLE-1", datosDoble, [
    "demanda.pdf", "auto-calificacion.pdf", "notificacion.pdf", "contestacion.pdf",
    "auto-citacion.pdf", "sentencia.pdf", "escrito-sustentacion.pdf", "sentencia-2inst.pdf",
  ]);
  const camino = ["admision", "retiro", "traslado", "contestacion", "preparacionAudiencia_doble",
    "citacionAudiencia_doble", "audienciaArt77", "audienciaArt80", "recurso",
    "remision2inst", "sustentacion2inst", "audiencia2inst", "sentencia2inst"];
  for (const et of camino) {
    const r = await patch(dDoble.id, et);
    check(r.status === 200, `→ ${et} (200)`, r.status !== 200 ? `status=${r.status} ${JSON.stringify(r.body?.error ?? "")}` : "");
  }
  const fin = await prisma.proceso.findUniqueOrThrow({ where: { id: dDoble.id }, select: { etapaActual: true, estado: true } });
  check(fin.etapaActual === "sentencia2inst", "quedó en sentencia2inst", `etapa=${fin.etapaActual}`);

  // ===== C) GATING de las correcciones =====
  console.log("\nC) Gating\n");
  // C1) Demandante·doble INADMISIÓN→RECHAZAR → recurso_rechazo disponible (200)
  const dInad = await crear("LAB-INAD-1", {
    rol: "Demandante", tipoInstancia: "Doble instancia",
    decisionAuto: "INADMISIÓN", fechaAdmision: "2026-06-01",
    decisionTrasSubsanacion: "RECHAZAR", fechaSubsanacion: "2026-06-08",
    recursoRechazo: "APELACIÓN", fechaRecursoRechazo: "2026-06-10", decisionRecursoRechazo: "DESFAVORABLE",
  }, ["demanda.pdf", "auto-calificacion.pdf", "subsanacion.pdf"]);
  const c1a = await patch(dInad.id, "subsanacion");
  check(c1a.status === 200, "INADMISIÓN → subsanación (200)", c1a.status !== 200 ? `status=${c1a.status}` : "");
  const c1b = await patch(dInad.id, "recurso_rechazo");
  check(c1b.status === 200, "RECHAZAR tras subsanar → recurso_rechazo disponible (200) [corrección 1]", c1b.status !== 200 ? `status=${c1b.status} ${JSON.stringify(c1b.body?.error ?? "")}` : "");
  const c1c = await patch(dInad.id, "archivado_rechazo");
  check(c1c.status === 200, "recurso DESFAVORABLE → archivado_rechazo (200)", c1c.status !== 200 ? `status=${c1c.status}` : "");

  // C2) Demandado·doble: NO debe poder ir a subsanación (gated rol=Demandante)
  const dDdo = await crear("LAB-DDO-1", { rol: "Demandado", tipoInstancia: "Doble instancia", decisionAuto: "INADMISIÓN", fechaAdmision: "2026-06-01" }, ["demanda.pdf", "auto-calificacion.pdf"]);
  const c2 = await patch(dDdo.id, "subsanacion");
  check(c2.status === 422, "Demandado → subsanación NO disponible (422) [D2]", `status=${c2.status}`);

  // C3) Demandante·única: 2ª instancia NO disponible (422)
  const dUni = await crear("LAB-UNI-1", { rol: "Demandante", tipoInstancia: "Única instancia", hayRecurso: "SI", concedeApelacion: "SI" }, ["demanda.pdf"]);
  const c3 = await patch(dUni.id, "remision2inst");
  check(c3.status === 422, "Única instancia → 2ª instancia NO disponible (422) [D3 acotado a doble]", `status=${c3.status}`);

  // ===== D) SALTO A TERMINAL DECIDIDO (auto-avance al guardar datos) =====
  console.log("\nD) Salto a terminal decidido (PATCH datos)\n");
  // D1) Retiro art. 67 = SÍ desde PRESENTACIÓN → archiva de una (sin papeleo intermedio).
  const dRet = await crear("LAB-RET-1", { rol: "Demandante", tipoInstancia: "Doble instancia" }, ["demanda.pdf"]);
  const d1 = await request(app).patch(`/procesos/${dRet.id}`).set(auth).send({ datos: { rol: "Demandante", tipoInstancia: "Doble instancia", hayRetiro: "SI" } });
  check(d1.status === 200, "PATCH datos hayRetiro=SI (200)", d1.status !== 200 ? `status=${d1.status}` : "");
  const estRet = await prisma.proceso.findUniqueOrThrow({ where: { id: dRet.id }, select: { etapaActual: true, estado: true } });
  check(estRet.etapaActual === "archivado" && estRet.estado === "CERRADO", "retiro=SÍ desde presentación → salta a archivado/CERRADO", `etapa=${estRet.etapaActual} estado=${estRet.estado}`);

  // D2) Sin decisión terminal NO salta: solo decisionAuto=ADMISIÓN (falta auto) → sigue en presentación.
  const dNo = await crear("LAB-NOSALTO-1", { rol: "Demandante", tipoInstancia: "Doble instancia" }, ["demanda.pdf"]);
  await request(app).patch(`/procesos/${dNo.id}`).set(auth).send({ datos: { rol: "Demandante", tipoInstancia: "Doble instancia", decisionAuto: "ADMISIÓN" } });
  const estNo = await prisma.proceso.findUniqueOrThrow({ where: { id: dNo.id }, select: { etapaActual: true, estado: true } });
  check(estNo.estado !== "CERRADO", "sin decisión terminal NO cierra (solo ADMISIÓN sin auto)", `etapa=${estNo.etapaActual} estado=${estNo.estado}`);

  console.log(`\n── Resultado: ${ok} OK · ${fail} fallos ──\n`);
  await limpiar();
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await limpiar().catch(() => {}); await prisma.$disconnect(); process.exit(1); });
