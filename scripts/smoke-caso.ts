/** Smoke: reiteración (PARCIAL→nuevo DdP con datos+cliente copiados) + tutela (NO)
 *  + cadena de caso. pnpm exec tsx scripts/smoke-caso.ts */
import request from "supertest";
import { prisma } from "../src/index";
import { createApp } from "../src/app";
import { hashPassword, signToken } from "../src/modules/auth/auth.service";

const RFC = "SMOKE-CASO";
const app = createApp();
const PASS = "Smoke123!";

async function limpiar() {
  const e = await prisma.empresa.findUnique({ where: { rfc: RFC }, select: { id: true } });
  if (!e) return;
  await prisma.proceso.deleteMany({ where: { empresaId: e.id } });
  await prisma.litigante.deleteMany({ where: { empresaId: e.id } });
  await prisma.empresa.delete({ where: { id: e.id } });
}

async function main() {
  await limpiar();
  const ddp = await prisma.tipoProceso.findFirstOrThrow({ where: { empresaId: null, nombre: { contains: "etici" } } });
  const empresa = await prisma.empresa.create({ data: { nombre: "SMOKE Caso", rfc: RFC, activo: true } });
  const admin = await prisma.usuario.create({ data: { email: "admin@smoke-caso.local", nombre: "Admin", password: await hashPassword(PASS), rol: "USUARIO", empresaId: empresa.id, esAdminEmpresa: true } });
  const cliente = await prisma.cliente.create({ data: { empresaId: empresa.id, nombre: "Peticionario Uno", estado: "CLIENTE" } });
  const dp1 = await prisma.proceso.create({
    data: {
      empresaId: empresa.id, tipoProcesoId: ddp.id, tipoEsquemaVersion: ddp.esquemaVersion,
      jurisdiccion: ddp.jurisdiccion, codigoInterno: "DDP-CASO-1", titulo: "Petición Uno",
      clienteId: cliente.id, creadoPorId: admin.id, etapaActual: "reiteracion",
      datos: { entidad: "Alcaldía X", correo: "x@x.co", tipoPeticion: "General", queSolicita: ["Copia"], detalle: "...", requierePoder: true, contestaron: "PARCIAL", fechaRadicacion: "2026-05-01", nroRadicado: "R-1", fechaRespuestaParcial: "2026-05-20", queFalto: "faltó algo" },
      historial: { create: { etapaKey: "reiteracion", usuarioId: admin.id } },
    },
  });

  const tok = signToken({ sub: admin.id, rol: "USUARIO", tv: admin.tokenVersion });
  const auth = { Authorization: `Bearer ${tok}` };
  const log = (s: string) => console.log("  " + s);
  console.log("\n── Smoke CASO ──\n");

  // 1) Derivar reiteración (DdP #2).
  const r1 = await request(app).post(`/procesos/${dp1.id}/derivar`).set(auth).send({});
  const dp2 = r1.body;
  const parte = (dp2.partes ?? [])[0];
  log(`1) derivar reiteración → ${r1.status} · tipo=${dp2.tipoProceso?.nombre} · casoRel=${dp2.casoRelacionadoId === dp1.id ? "OK" : "MAL"}`);
  log(`   datos copiados: entidad=${dp2.datos?.entidad} tipoPeticion=${dp2.datos?.tipoPeticion} queSolicita=${JSON.stringify(dp2.datos?.queSolicita)} requierePoder=${dp2.datos?.requierePoder}`);
  log(`   NO copiados: contestaron=${dp2.datos?.contestaron ?? "(vacío ✓)"} fechaRadicacion=${dp2.datos?.fechaRadicacion ?? "(vacío ✓)"}`);
  log(`   cliente: clienteId=${dp2.cliente?.id === cliente.id ? "OK" : dp2.cliente?.id} parte=${parte?.litigante?.nombre} rol=${parte?.rol} etiqueta=${parte?.rolEtiqueta} esNuestro=${parte?.esNuestroCliente}`);

  // 2) Cadena de caso desde #1.
  const r2 = await request(app).get(`/procesos/${dp1.id}/caso`).set(auth);
  log(`2) GET /caso(#1) → ${r2.status} · [${r2.body.map((n: { codigoInterno: string }) => n.codigoInterno).join(" → ")}]`);

  // 3) Llevar #2 a escala_tutela y derivar Tutela.
  await prisma.proceso.update({ where: { id: dp2.id }, data: { etapaActual: "escala_tutela", datos: { ...dp2.datos, contestaron: "NO" } } });
  const r3 = await request(app).post(`/procesos/${dp2.id}/derivar`).set(auth).send({});
  const tut = r3.body;
  const parteT = (tut.partes ?? [])[0];
  log(`3) derivar tutela → ${r3.status} · tipo=${tut.tipoProceso?.nombre} · casoRel=${tut.casoRelacionadoId === dp2.id ? "OK" : "MAL"} · parteRol=${parteT?.rol} (esJudicial→ACCIONANTE)`);

  // 4) Cadena completa desde la tutela (debe traer los 3).
  const r4 = await request(app).get(`/procesos/${tut.id}/caso`).set(auth);
  log(`4) GET /caso(tutela) → ${r4.status} · [${r4.body.map((n: { codigoInterno: string }) => n.codigoInterno).join(" → ")}]`);

  console.log("");
  await limpiar();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await limpiar().catch(() => {}); await prisma.$disconnect(); process.exit(1); });
