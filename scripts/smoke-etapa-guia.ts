/** Smoke: el gate de etapa (PATCH /procesos/:id/etapa) devuelve el contrato
 *  { faltantes, documentosFaltantes } que la UI usa para guiar al formulario
 *  (change procesos-etapa-guia-campos). pnpm exec tsx scripts/smoke-etapa-guia.ts */
import request from "supertest";
import { prisma } from "../src/index";
import { createApp } from "../src/app";
import { hashPassword, signToken } from "../src/modules/auth/auth.service";

const RFC = "SMOKE-ETAPA-GUIA";
const app = createApp();
const PASS = "Smoke123!";

async function limpiar() {
  const e = await prisma.empresa.findUnique({ where: { rfc: RFC }, select: { id: true } });
  if (!e) return;
  await prisma.proceso.deleteMany({ where: { empresaId: e.id } });
  await prisma.litigante.deleteMany({ where: { empresaId: e.id } });
  await prisma.empresa.delete({ where: { id: e.id } });
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log("  ✅ " + name);
  } else {
    fail++;
    console.log("  ❌ " + name, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

async function main() {
  await limpiar();
  const ddp = await prisma.tipoProceso.findFirstOrThrow({
    where: { empresaId: null, nombre: { contains: "etici" } },
  });
  const empresa = await prisma.empresa.create({ data: { nombre: "SMOKE EtapaGuia", rfc: RFC, activo: true } });
  const admin = await prisma.usuario.create({
    data: { email: "admin@smoke-etapa.local", nombre: "Admin", password: await hashPassword(PASS), rol: "USUARIO", empresaId: empresa.id, esAdminEmpresa: true },
  });
  const cliente = await prisma.cliente.create({ data: { empresaId: empresa.id, nombre: "Peticionario", estado: "CLIENTE" } });

  const baseDatos = {
    entidad: "Alcaldía X",
    correo: "x@x.co",
    tipoPeticion: "General",
    queSolicita: ["Copia"],
    detalle: "...",
    requierePoder: true,
  };

  async function nuevoDdp(codigo: string, datos: Record<string, unknown>) {
    return prisma.proceso.create({
      data: {
        empresaId: empresa.id, tipoProcesoId: ddp.id, tipoEsquemaVersion: ddp.esquemaVersion,
        jurisdiccion: ddp.jurisdiccion, codigoInterno: codigo, titulo: codigo,
        clienteId: cliente.id, creadoPorId: admin.id, etapaActual: "borrador",
        datos: datos as object,
        historial: { create: { etapaKey: "borrador", usuarioId: admin.id } },
      },
    });
  }

  const tok = signToken({ sub: admin.id, rol: "USUARIO", tv: admin.tokenVersion });
  const auth = { Authorization: `Bearer ${tok}` };
  const mover = (id: string) =>
    request(app).patch(`/procesos/${id}/etapa`).set(auth).send({ etapaKey: "radicada" });

  console.log("\n── Smoke etapa-guia (gate radicada) ──\n");

  // 1) Campos + docs vacíos → 400 con AMBAS listas (la UI abre el form, marca campos, nombra docs)
  const p1 = await nuevoDdp("DDP-GUIA-1", { ...baseDatos });
  const r1 = await mover(p1.id);
  const i1 = r1.body?.error?.issues ?? {};
  check("bloqueo campos+docs → 400", r1.status === 400, r1.status);
  check("faltantes = [fechaRadicacion, nroRadicado]",
    Array.isArray(i1.faltantes) && i1.faltantes.includes("fechaRadicacion") && i1.faltantes.includes("nroRadicado"),
    i1.faltantes);
  check("documentosFaltantes incluye peticion.pdf y poder.pdf (requierePoder=true)",
    Array.isArray(i1.documentosFaltantes) && i1.documentosFaltantes.includes("peticion.pdf") && i1.documentosFaltantes.includes("poder.pdf"),
    i1.documentosFaltantes);

  // 2) Solo un campo lleno → el otro sigue faltante (premisa del auto-clearing por-campo de la UI)
  const p2 = await nuevoDdp("DDP-GUIA-2", { ...baseDatos, nroRadicado: "R-9" });
  const r2 = await mover(p2.id);
  const i2 = r2.body?.error?.issues ?? {};
  check("con nroRadicado lleno → faltantes solo [fechaRadicacion]",
    Array.isArray(i2.faltantes) && i2.faltantes.includes("fechaRadicacion") && !i2.faltantes.includes("nroRadicado"),
    i2.faltantes);

  // 3) requierePoder=false → poder.pdf NO se exige (requeridoSi condicional)
  const p3 = await nuevoDdp("DDP-GUIA-3", { ...baseDatos, requierePoder: false });
  const r3 = await mover(p3.id);
  const i3 = r3.body?.error?.issues ?? {};
  check("requierePoder=false → documentosFaltantes NO incluye poder.pdf",
    Array.isArray(i3.documentosFaltantes) && !i3.documentosFaltantes.includes("poder.pdf") && i3.documentosFaltantes.includes("peticion.pdf"),
    i3.documentosFaltantes);

  // 4) Campos llenos + docs adjuntos → avanza (lo que ya marcado deja de ser faltante)
  const p4 = await nuevoDdp("DDP-GUIA-4", { ...baseDatos, fechaRadicacion: "2026-06-10", nroRadicado: "R-4" });
  await prisma.documentoProceso.createMany({
    data: [
      { procesoId: p4.id, nombre: "peticion.pdf", url: "demo/peticion.pdf" },
      { procesoId: p4.id, nombre: "poder.pdf", url: "demo/poder.pdf" },
    ],
  });
  const r4 = await mover(p4.id);
  check("campos llenos + docs adjuntos → 200 (avanza a radicada)", r4.status === 200, { status: r4.status, body: r4.body?.error });
  check("etapaActual = radicada", r4.body?.etapaActual === "radicada", r4.body?.etapaActual);

  console.log(`\n  Resultado: ${pass} ✅ / ${fail} ❌\n`);
  await limpiar();
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
