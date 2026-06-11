import request from "supertest";
import { prisma } from "../src/index";
import { createApp } from "../src/app";
import { hashPassword, signToken } from "../src/modules/auth/auth.service";
const RFC = "SMOKE-SEG"; const app = createApp(); const PASS = "Smoke123!";
const dAgo = (n: number) => new Date(Date.now() - n * 86400000);
const dIn = (n: number) => new Date(Date.now() + n * 86400000);
async function limpiar() {
  const e = await prisma.empresa.findUnique({ where: { rfc: RFC }, select: { id: true } });
  if (!e) return;
  await prisma.seguimientoComercial.deleteMany({ where: { empresaId: e.id } });
  await prisma.faseComercialHistorial.deleteMany({ where: { empresaId: e.id } });
  await prisma.empresa.delete({ where: { id: e.id } });
}
async function main() {
  await limpiar();
  const plan = await prisma.plan.findFirstOrThrow({ select: { id: true } });
  const mod = await prisma.modulo.findUniqueOrThrow({ where: { clave: "comercial" }, select: { id: true } });
  const empresa = await prisma.empresa.create({ data: { nombre: "SMOKE Seg", rfc: RFC, activo: true } });
  await prisma.suscripcion.create({ data: { empresaId: empresa.id, planId: plan.id, estado: "ACTIVA", modulos: { create: { moduloId: mod.id, habilitado: true } } } });
  const admin = await prisma.usuario.create({ data: { email: "a@smoke-seg.local", nombre: "Admin", password: await hashPassword(PASS), rol: "USUARIO", empresaId: empresa.id, esAdminEmpresa: true } });
  const mk = (nombre: string) => prisma.cliente.create({ data: { empresaId: empresa.id, nombre, estado: "PROSPECTO", responsableComercialId: admin.id } });
  const seg = (clienteId: string, d: Partial<{ fechaContacto: Date; fechaProximaTarea: Date; disposicion: string }>) =>
    prisma.seguimientoComercial.create({ data: { empresaId: empresa.id, clienteId, comercialId: admin.id, tipoGestion: "LLAMADA", ...(d as any) } });

  const p1 = await mk("P1 sin gestion");
  const p2 = await mk("P2 frio 10d"); await seg(p2.id, { fechaContacto: dAgo(10) });
  const p3 = await mk("P3 vencida"); await seg(p3.id, { fechaProximaTarea: dAgo(1) });
  const p4 = await mk("P4 hoy"); await seg(p4.id, { fechaProximaTarea: new Date() });
  const p5 = await mk("P5 negociacion"); await prisma.faseComercialHistorial.create({ data: { empresaId: empresa.id, clienteId: p5.id, fase: "NEGOCIACION", fechaInicioFase: dAgo(5) } });

  const tok = signToken({ sub: admin.id, rol: "USUARIO", tv: admin.tokenVersion });
  const auth = { Authorization: `Bearer ${tok}` };
  const log = (s: string) => console.log("  " + s);
  console.log("\n── Smoke SEGUIMIENTO ──\n");

  const pipe = (await request(app).get("/comercial/pipeline").set(auth)).body;
  const byName = (n: string) => pipe.find((x: any) => x.nombre === n);
  log(`pipeline (${pipe.length} clientes):`);
  log(`  P2 diasSinGestion=${byName("P2 frio 10d")?.diasSinGestion} (esp 10)`);
  log(`  P3 tareaVencida=${byName("P3 vencida")?.tareaVencida} (esp true)`);
  log(`  P5 faseActual=${byName("P5 negociacion")?.faseActual} diasEnFase=${byName("P5 negociacion")?.diasEnFase} (esp NEGOCIACION/5)`);

  const hoy = (await request(app).get("/comercial/hoy").set(auth)).body;
  log(`hoy: vencidas=[${hoy.vencidas.map((x: any) => x.nombre).join(",")}] hoy=[${hoy.hoy.map((x: any) => x.nombre).join(",")}] frios=[${hoy.frios.map((x: any) => x.nombre).join(",")}]`);

  // disposicion persiste
  const r = await request(app).post("/comercial/seguimientos").set(auth).send({ clienteId: p1.id, tipoGestion: "LLAMADA", disposicion: "INTERESADO", resultado: "quiere propuesta" });
  log(`registrar gestión con disposición → ${r.status} · disposicion=${r.body.disposicion}`);
  const pipe2 = (await request(app).get("/comercial/pipeline").set(auth)).body;
  log(`P1 ultimaDisposicion=${pipe2.find((x: any) => x.nombre === "P1 sin gestion")?.ultimaDisposicion} (esp INTERESADO)`);

  console.log("");
  await limpiar(); await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await limpiar().catch(() => {}); await prisma.$disconnect(); process.exit(1); });
