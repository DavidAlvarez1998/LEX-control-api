/** Smoke del flujo de tutela (changes tutela-creacion-simple + tutela-seguimiento-flujo):
 *  A) Esquema sembrado: campo fechaImpugnacion (soloFicha, mostrarSi impugnada=SI) +
 *     docs de seguimiento contextuales (opcionalesSi) y demanda.pdf obligatorio.
 *  B) Documentos opcionales aparecen según el avance (auto admisorio si admitida=SI,
 *     sentencia si fallo, impugnación/2ª instancia si impugnada=SI, desacato si SI).
 *  C) Las etapas del seguimiento NO bloquean por esos documentos (son opción de adjuntar);
 *     impugnacion sigue gated por disponibleSi (impugnada=SI).
 *  pnpm exec tsx scripts/smoke-tutela-flujo.ts */
import request from "supertest";
import { prisma } from "../src/index";
import { createApp } from "../src/app";
import { hashPassword, signToken } from "../src/modules/auth/auth.service";
import { evaluarCondicion, type EtapaDef, type CampoEsquema } from "../src/modules/procesos/esquema";

const RFC = "SMOKE-TUTELA";
const app = createApp();
const PASS = "Smoke123!";
let ok = 0, fail = 0;
const log = (s: string) => console.log("  " + s);
function check(cond: boolean, label: string, extra = "") {
  (cond ? ok++ : fail++);
  log(`${cond ? "✓" : "✗ FALLO"} ${label}${extra ? " · " + extra : ""}`);
}

// Mirror del documentosOpcionalesDeEtapas del cliente (mismo evaluador de condiciones).
function opcionales(etapas: EtapaDef[], datos: Record<string, unknown>): Set<string> {
  const set = new Set<string>();
  for (const e of etapas) {
    if (e.disponibleSi && !evaluarCondicion(e.disponibleSi, datos)) continue;
    for (const n of e.reglas?.documentosOpcionales ?? []) set.add(n.toLowerCase());
    for (const x of e.reglas?.opcionalesSi ?? [])
      if (evaluarCondicion(x.si, datos)) for (const n of x.documentosOpcionales ?? []) set.add(n.toLowerCase());
  }
  return set;
}
function requeridos(etapas: EtapaDef[], datos: Record<string, unknown>): Set<string> {
  const set = new Set<string>();
  for (const e of etapas) {
    if (e.disponibleSi && !evaluarCondicion(e.disponibleSi, datos)) continue;
    for (const n of e.reglas?.documentosRequeridos ?? []) set.add(n.toLowerCase());
    for (const x of e.reglas?.requeridosSi ?? [])
      if (evaluarCondicion(x.si, datos)) for (const n of x.documentosRequeridos ?? []) set.add(n.toLowerCase());
  }
  return set;
}

async function limpiar() {
  const e = await prisma.empresa.findUnique({ where: { rfc: RFC }, select: { id: true } });
  if (!e) return;
  await prisma.proceso.deleteMany({ where: { empresaId: e.id } });
  await prisma.litigante.deleteMany({ where: { empresaId: e.id } });
  await prisma.empresa.delete({ where: { id: e.id } });
}

async function main() {
  await limpiar();
  const tutela = await prisma.tipoProceso.findFirstOrThrow({ where: { empresaId: null, nombre: "Acción de tutela" } });
  const esquema = tutela.esquemaFormulario as unknown as CampoEsquema[];
  const etapas = tutela.etapas as unknown as EtapaDef[];

  console.log("\n── Smoke TUTELA FLUJO ──\n");

  // ============ A) ESQUEMA SEMBRADO ============
  console.log("A) Esquema sembrado\n");
  const fImp = esquema.find((c) => c.key === "fechaImpugnacion");
  check(!!fImp, "campo fechaImpugnacion existe");
  check(fImp?.tipo === "fecha" && (fImp as { soloFicha?: boolean }).soloFicha === true, "fechaImpugnacion: fecha + soloFicha", `tipo=${fImp?.tipo}`);
  check(
    !!fImp?.mostrarSi && evaluarCondicion(fImp.mostrarSi, { impugnada: "SI" }) && !evaluarCondicion(fImp.mostrarSi, { impugnada: "NO" }),
    "fechaImpugnacion mostrarSi impugnada=SI",
  );
  const entidad = esquema.find((c) => c.key === "entidadAccionada");
  check(entidad?.requerido === true, "entidadAccionada sigue obligatorio (identifica la tutela)");

  // ============ B) DOCUMENTOS CONTEXTUALES ============
  console.log("\nB) Documentos contextuales\n");
  // Base (sin avance): demanda obligatoria; pruebas/anexos opcionales; nada de seguimiento.
  const reqBase = requeridos(etapas, {});
  const optBase = opcionales(etapas, {});
  check(reqBase.has("demanda.pdf"), "demanda.pdf obligatorio en radicación", `[${[...reqBase].join(", ")}]`);
  check(optBase.has("pruebas.pdf") && optBase.has("anexos.pdf"), "pruebas/anexos opcionales");
  check(!optBase.has("auto_admisorio.pdf") && !reqBase.has("auto_admisorio.pdf"), "auto admisorio NO aparece sin admitir");
  check(!optBase.has("sentencia.pdf"), "sentencia NO aparece sin fallo");

  // admitida=SI → auto admisorio (opcional, no obligatorio)
  const optAdm = opcionales(etapas, { admitida: "SI" });
  const reqAdm = requeridos(etapas, { admitida: "SI" });
  check(optAdm.has("auto_admisorio.pdf"), "admitida=SI → auto admisorio aparece (opción de adjuntar)");
  check(!reqAdm.has("auto_admisorio.pdf"), "auto admisorio NO es obligatorio (no bloquea)");

  // fallo registrado → sentencia
  check(opcionales(etapas, { falloPrimera: "Favorable" }).has("sentencia.pdf"), "falloPrimera=Favorable → sentencia aparece");
  check(opcionales(etapas, { falloPrimera: "Desfavorable" }).has("sentencia.pdf"), "falloPrimera=Desfavorable → sentencia aparece");

  // Doc-aligned: impugnación y fallo 2ª instancia NO tienen PDF en el doc (solo fecha/
  // decisión) → no se ofrece ningún documento ahí.
  const optImp = opcionales(etapas, { impugnada: "SI" });
  check(!optImp.has("impugnacion.pdf"), "impugnada=SI → NO se pide PDF de impugnación (no está en el doc)");
  check(!optImp.has("sentencia_segunda.pdf"), "impugnada=SI → NO se pide PDF de 2ª instancia (no está en el doc)");

  // desacato=SI → escrito + fallo del desacato (sí están en el doc)
  const optDes = opcionales(etapas, { incidenteDesacato: "SI" });
  check(optDes.has("escrito_desacato.pdf") && optDes.has("fallo_desacato.pdf"), "incidenteDesacato=SI → escrito + fallo del desacato");

  // Conjunto total de documentos = exactamente los del doc (sin extras).
  const todos = new Set<string>();
  for (const datos of [{}, { admitida: "SI" }, { falloPrimera: "Favorable" }, { impugnada: "SI" }, { incidenteDesacato: "SI" }]) {
    requeridos(etapas, datos).forEach((d) => todos.add(d));
    opcionales(etapas, datos).forEach((d) => todos.add(d));
  }
  const esperados = ["demanda.pdf", "pruebas.pdf", "anexos.pdf", "auto_admisorio.pdf", "sentencia.pdf", "escrito_desacato.pdf", "fallo_desacato.pdf"];
  const extra = [...todos].filter((d) => !esperados.includes(d));
  check(extra.length === 0, "NO hay documentos fuera del doc", `extra=[${extra.join(", ")}]`);

  // ============ C) FLUJO DE ETAPAS (API) ============
  console.log("\nC) Flujo de etapas (API)\n");
  const empresa = await prisma.empresa.create({ data: { nombre: "SMOKE Tutela", rfc: RFC, activo: true } });
  const admin = await prisma.usuario.create({ data: { email: "admin@smoke-tutela.local", nombre: "Admin", password: await hashPassword(PASS), rol: "USUARIO", empresaId: empresa.id, esAdminEmpresa: true } });
  const cliente = await prisma.cliente.create({ data: { empresaId: empresa.id, nombre: "Accionante Uno", estado: "CLIENTE" } });
  const tok = signToken({ sub: admin.id, rol: "USUARIO", tv: admin.tokenVersion });
  const auth = { Authorization: `Bearer ${tok}` };

  const proc = await prisma.proceso.create({
    data: {
      empresaId: empresa.id, tipoProcesoId: tutela.id, tipoEsquemaVersion: tutela.esquemaVersion,
      jurisdiccion: tutela.jurisdiccion, codigoInterno: "TUT-SMOKE-1", titulo: "Acción de tutela — Colpensiones",
      clienteId: cliente.id, creadoPorId: admin.id, etapaActual: "radicacion",
      datos: { entidadAccionada: "Colpensiones" },
      historial: { create: { etapaKey: "radicacion", usuarioId: admin.id } },
    },
  });
  await prisma.documentoProceso.create({ data: { procesoId: proc.id, nombre: "demanda.pdf", url: "http://x/demanda.pdf" } });

  // 1) radicación → admisión: NO exige auto admisorio (200)
  const a = await request(app).patch(`/procesos/${proc.id}/etapa`).set(auth).send({ etapaKey: "admision" });
  check(a.status === 200, "radicación → admisión sin auto admisorio (200)", `status=${a.status} ${JSON.stringify(a.body?.error?.issues ?? "")}`);

  // 2) marcar admitida=SI y avanzar a fallo 1ª: NO exige sentencia (200)
  await prisma.proceso.update({ where: { id: proc.id }, data: { datos: { entidadAccionada: "Colpensiones", admitida: "SI" } } });
  const b = await request(app).patch(`/procesos/${proc.id}/etapa`).set(auth).send({ etapaKey: "falloPrimeraInstancia" });
  check(b.status === 200, "admisión → fallo 1ª sin sentencia (200)", `status=${b.status} ${JSON.stringify(b.body?.error?.issues ?? "")}`);

  // 3) impugnacion gated: con impugnada vacía/NO → 422 (no disponible)
  const c = await request(app).patch(`/procesos/${proc.id}/etapa`).set(auth).send({ etapaKey: "impugnacion" });
  check(c.status === 422, "impugnación sin impugnada=SI → 422 (gated)", `status=${c.status}`);

  // 4) impugnada=SI → impugnacion disponible, sin exigir documento (200)
  await prisma.proceso.update({ where: { id: proc.id }, data: { datos: { entidadAccionada: "Colpensiones", admitida: "SI", falloPrimera: "Desfavorable", impugnada: "SI" } } });
  const d = await request(app).patch(`/procesos/${proc.id}/etapa`).set(auth).send({ etapaKey: "impugnacion" });
  check(d.status === 200, "impugnada=SI → impugnación disponible sin doc (200)", `status=${d.status} ${JSON.stringify(d.body?.error?.issues ?? "")}`);

  console.log(`\n── Resultado: ${ok} OK · ${fail} fallos ──\n`);
  await limpiar();
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await limpiar().catch(() => {}); await prisma.$disconnect(); process.exit(1); });
