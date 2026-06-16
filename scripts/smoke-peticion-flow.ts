/** Smoke del flujo trámites-petición (changes peticion-tramite-flow + ddp-recibido-completion):
 *  A) DdP enviado: plantillas casoBase solo en derivado, derivar hereda responsable, GET /caso expone radicado.
 *  B) DdP Recibido: medioRespuesta requerido al contestar + plantilla "Respuesta a la petición recibida".
 *  pnpm exec tsx scripts/smoke-peticion-flow.ts */
import request from "supertest";
import { prisma } from "../src/index";
import { createApp } from "../src/app";
import { hashPassword, signToken } from "../src/modules/auth/auth.service";

const RFC = "SMOKE-PETFLOW";
const app = createApp();
const PASS = "Smoke123!";
let ok = 0, fail = 0;
const log = (s: string) => console.log("  " + s);
function check(cond: boolean, label: string, extra = "") {
  (cond ? ok++ : fail++);
  log(`${cond ? "✓" : "✗ FALLO"} ${label}${extra ? " · " + extra : ""}`);
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
  const ddp = await prisma.tipoProceso.findFirstOrThrow({ where: { empresaId: null, nombre: "Derecho de Petición" } });
  const recibido = await prisma.tipoProceso.findFirstOrThrow({ where: { empresaId: null, nombre: "Derecho de Petición Recibido" } });

  const empresa = await prisma.empresa.create({ data: { nombre: "SMOKE PetFlow", rfc: RFC, activo: true } });
  const admin = await prisma.usuario.create({ data: { email: "admin@smoke-petflow.local", nombre: "Admin", password: await hashPassword(PASS), rol: "USUARIO", empresaId: empresa.id, esAdminEmpresa: true } });
  const abogado = await prisma.usuario.create({ data: { email: "abg@smoke-petflow.local", nombre: "Abogada Responsable", password: await hashPassword(PASS), rol: "USUARIO", empresaId: empresa.id } });
  const cliente = await prisma.cliente.create({ data: { empresaId: empresa.id, nombre: "Peticionario Uno", estado: "CLIENTE" } });

  const tok = signToken({ sub: admin.id, rol: "USUARIO", tv: admin.tokenVersion });
  const auth = { Authorization: `Bearer ${tok}` };

  console.log("\n── Smoke PETICIÓN FLOW ──\n");

  // ============ A) DdP ENVIADO ============
  console.log("A) DdP enviado\n");
  const dp1 = await prisma.proceso.create({
    data: {
      empresaId: empresa.id, tipoProcesoId: ddp.id, tipoEsquemaVersion: ddp.esquemaVersion,
      jurisdiccion: ddp.jurisdiccion, codigoInterno: "PETF-1", titulo: "Petición Uno",
      clienteId: cliente.id, creadoPorId: admin.id, responsableId: abogado.id, etapaActual: "reiteracion",
      datos: { entidad: "Alcaldía X", correo: "x@x.co", tipoPeticion: "General", queSolicita: ["Copia"], detalle: "...", contestaron: "PARCIAL", fechaRadicacion: "2026-05-01", nroRadicado: "R-100", fechaRespuestaParcial: "2026-05-20", queFalto: "faltó algo" },
      historial: { create: { etapaKey: "reiteracion", usuarioId: admin.id } },
    },
  });

  // 1) plantillas en el ORIGINAL: casoBase oculta, base visible
  const pl1 = await request(app).get(`/procesos/${dp1.id}/plantillas`).set(auth);
  const nombres1 = (pl1.body as { nombre: string }[]).map((p) => p.nombre);
  check(pl1.status === 200 && !nombres1.some((n) => n.toLowerCase().includes("reiteraci")), "reiteración OCULTA en el original", `[${nombres1.join(", ")}]`);
  check(nombres1.some((n) => n === "Derecho de petición"), "plantilla base visible en el original");

  // 2) generar reiteración en el original → 422
  const reiterPl = await prisma.plantillaDocumento.findFirstOrThrow({ where: { tipoProcesoId: ddp.id, nombre: { contains: "Reiteración" } } });
  const gen422 = await request(app).post(`/procesos/${dp1.id}/documentos/generar`).set(auth).send({ plantillaId: reiterPl.id });
  check(gen422.status === 422, "generar reiteración en original → 422", `status=${gen422.status}`);

  // 3) derivar reiteración → hereda responsable
  const der = await request(app).post(`/procesos/${dp1.id}/derivar`).set(auth).send({});
  const dp2 = der.body;
  check(der.status === 201 || der.status === 200, "derivar reiteración", `status=${der.status}`);
  check(dp2.casoRelacionadoId === dp1.id, "casoRelacionadoId apunta al original");
  check(dp2.responsable?.id === abogado.id || dp2.responsableId === abogado.id, "derivado HEREDA responsableId", `resp=${dp2.responsable?.nombre ?? dp2.responsableId}`);

  // 4) plantillas en el DERIVADO: reiteración visible
  const pl2 = await request(app).get(`/procesos/${dp2.id}/plantillas`).set(auth);
  const nombres2 = (pl2.body as { nombre: string }[]).map((p) => p.nombre);
  check(nombres2.some((n) => n.toLowerCase().includes("reiteraci")), "reiteración VISIBLE en el derivado", `[${nombres2.join(", ")}]`);

  // 5) render reiteración en el derivado → cita radicado del caso base
  const rend = await request(app).post(`/procesos/${dp2.id}/documentos/render`).set(auth).send({ plantillaId: reiterPl.id });
  check(rend.status === 200 && String(rend.body.contenido).includes("R-100"), "render reiteración cita radicado base (R-100)", `status=${rend.status}`);

  // 6) GET /caso expone radicado resuelto
  const caso = await request(app).get(`/procesos/${dp1.id}/caso`).set(auth);
  const nodo1 = (caso.body as { codigoInterno: string; radicado: string | null }[]).find((n) => n.codigoInterno === "PETF-1");
  check(caso.status === 200 && nodo1?.radicado === "R-100", "GET /caso expone radicado=R-100", `radicado=${nodo1?.radicado}`);

  // ============ B) DdP RECIBIDO ============
  console.log("\nB) DdP Recibido\n");
  const rec = await prisma.proceso.create({
    data: {
      empresaId: empresa.id, tipoProcesoId: recibido.id, tipoEsquemaVersion: recibido.esquemaVersion,
      jurisdiccion: recibido.jurisdiccion, codigoInterno: "PETF-REC-1", titulo: "Recibido Uno",
      creadoPorId: admin.id, etapaActual: "recepcion",
      datos: { radicadoIngreso: "ING-9", fechaRecepcion: "2026-06-01", peticionario: "Juan Pérez", correo: "jp@mail.com", direccion: "Calle 1", tipoPeticion: "General", queSolicita: ["Información"], contestada: "SI", fechaContestacion: "2026-06-10" },
      historial: { create: { etapaKey: "recepcion", usuarioId: admin.id } },
    },
  });
  // respuesta.pdf presente (para aislar el gate al campo medioRespuesta)
  await prisma.documentoProceso.create({ data: { procesoId: rec.id, nombre: "respuesta.pdf", url: "http://x/respuesta.pdf" } });

  // 1) contestar SI sin medioRespuesta → 400, faltante = medioRespuesta
  const mov400 = await request(app).patch(`/procesos/${rec.id}/etapa`).set(auth).send({ etapaKey: "contestacion" });
  const faltantes400 = mov400.body?.error?.issues?.faltantes ?? [];
  check(mov400.status === 400 && faltantes400.includes("medioRespuesta"), "contestar SI sin medioRespuesta → 400 (falta medioRespuesta)", `status=${mov400.status} faltantes=${JSON.stringify(faltantes400)}`);

  // 2) set medioRespuesta y avanzar → 200
  await prisma.proceso.update({ where: { id: rec.id }, data: { datos: { ...(rec.datos as object), medioRespuesta: "Correo electrónico" } } });
  const mov200 = await request(app).patch(`/procesos/${rec.id}/etapa`).set(auth).send({ etapaKey: "contestacion" });
  check(mov200.status === 200, "con medioRespuesta → avanza a Respuesta (200)", `status=${mov200.status}`);

  // 3) plantilla de respuesta del recibido disponible
  const plR = await request(app).get(`/procesos/${rec.id}/plantillas`).set(auth);
  const nombresR = (plR.body as { nombre: string }[]).map((p) => p.nombre);
  check(nombresR.some((n) => n.toLowerCase().includes("respuesta a la petici")), "plantilla 'Respuesta a la petición recibida' disponible", `[${nombresR.join(", ")}]`);

  // 4) render de esa plantilla → 200 con el peticionario
  const plRec = await prisma.plantillaDocumento.findFirstOrThrow({ where: { tipoProcesoId: recibido.id, nombre: { contains: "Respuesta a la petición" } } });
  const rendR = await request(app).post(`/procesos/${rec.id}/documentos/render`).set(auth).send({ plantillaId: plRec.id });
  check(rendR.status === 200 && String(rendR.body.contenido).toUpperCase().includes("JUAN PÉREZ"), "render respuesta-recibida incluye al peticionario", `status=${rendR.status}`);

  console.log(`\n── Resultado: ${ok} OK · ${fail} fallos ──\n`);
  await limpiar();
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await limpiar().catch(() => {}); await prisma.$disconnect(); process.exit(1); });
