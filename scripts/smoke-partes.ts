/** Smoke de gestión de PARTES desde la ficha (POST/PATCH/DELETE /procesos/:id/partes)
 *  + auto-título laboral que sigue a las partes + salvedad tituloManual.
 *  Reproduce el caso reportado: agregar un DEMANDADO a un proceso laboral.
 *  pnpm exec tsx scripts/smoke-partes.ts */
import request from "supertest";
import { prisma } from "../src/index";
import { createApp } from "../src/app";
import { hashPassword, signToken } from "../src/modules/auth/auth.service";
import type { EtapaDef } from "../src/modules/procesos/esquema";

const RFC = "SMOKE-PARTES";
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
  console.log("\n── Smoke PARTES + auto-título laboral ──\n");

  const laboral = await prisma.tipoProceso.findFirstOrThrow({ where: { empresaId: null, nombre: "Proceso Laboral" } });
  const etapas = laboral.etapas as unknown as EtapaDef[];
  const entrada = etapas.slice().sort((a, b) => a.orden - b.orden)[0].key;

  const empresa = await prisma.empresa.create({ data: { nombre: "SMOKE Partes", rfc: RFC, activo: true } });
  const admin = await prisma.usuario.create({ data: { email: "admin@smoke-partes.local", nombre: "Admin", password: await hashPassword(PASS), rol: "USUARIO", empresaId: empresa.id, esAdminEmpresa: true } });
  const tok = signToken({ sub: admin.id, rol: "USUARIO", tv: admin.tokenVersion });
  const auth = { Authorization: `Bearer ${tok}` };

  // Cliente "Sara" como parte demandante (esNuestroCliente). datos.rol = "Demandante".
  const cliente = await prisma.cliente.create({ data: { empresaId: empresa.id, nombre: "Sara", estado: "CLIENTE" } });
  const litSara = await prisma.litigante.create({ data: { empresaId: empresa.id, nombre: "Sara", tipoPersona: "NATURAL", correos: [] } });
  const proc = await prisma.proceso.create({
    data: {
      empresaId: empresa.id, tipoProcesoId: laboral.id, tipoEsquemaVersion: laboral.esquemaVersion,
      jurisdiccion: laboral.jurisdiccion, codigoInterno: "LAB-SMOKE-1", titulo: "Proceso Laboral — Sara",
      clienteId: cliente.id, creadoPorId: admin.id, etapaActual: entrada,
      datos: { rol: "Demandante" },
      historial: { create: { etapaKey: entrada, usuarioId: admin.id } },
      partes: { create: { litiganteId: litSara.id, rol: "DEMANDANTE", esNuestroCliente: true } },
    },
  });

  // 1) Agregar DEMANDADO "Pedro" con documento (caso del usuario) → 201
  const r1 = await request(app).post(`/procesos/${proc.id}/partes`).set(auth)
    .send({ litigante: { nombre: "Pedro", tipoPersona: "NATURAL", tipoDocumento: "CC", numeroDocumento: "123", correos: [] }, rol: "DEMANDADO" });
  check(r1.status === 201, "POST demandado con doc → 201", `status=${r1.status} ${JSON.stringify(r1.body?.error ?? "")}`);
  check(r1.body?.titulo === "Proceso Laboral — Sara vs. Pedro", "título recalculado a 'Sara vs. Pedro'", `titulo=${r1.body?.titulo}`);
  check((r1.body?.partes ?? []).length === 2, "ahora hay 2 partes");

  // 2) Agregar TERCERO con documento VACÍO (numeroDocumento null) → 201 (tolerancia schema)
  const r2 = await request(app).post(`/procesos/${proc.id}/partes`).set(auth)
    .send({ litigante: { nombre: "Tercero SA", tipoPersona: "JURIDICA", numeroDocumento: null, correos: [] }, rol: "TERCERO" });
  check(r2.status === 201, "POST tercero con doc vacío (null) → 201 (no 400/500)", `status=${r2.status} ${JSON.stringify(r2.body?.error ?? "")}`);

  // 3) Editar al demandado (renombrar a "Pedro Pérez") → título sigue
  const pedro = (r2.body?.partes ?? []).find((p: { rol: string }) => p.rol === "DEMANDADO");
  const r3 = await request(app).patch(`/procesos/${proc.id}/partes/${pedro.id}`).set(auth)
    .send({ litigante: { nombre: "Pedro Pérez" } });
  check(r3.status === 200, "PATCH renombrar demandado → 200", `status=${r3.status}`);
  check(r3.body?.titulo === "Proceso Laboral — Sara vs. Pedro Pérez", "título sigue al renombrar", `titulo=${r3.body?.titulo}`);

  // 4) DELETE: no se puede quitar a nuestro cliente
  const sara = (r3.body?.partes ?? []).find((p: { esNuestroCliente: boolean }) => p.esNuestroCliente);
  const rDelCli = await request(app).delete(`/procesos/${proc.id}/partes/${sara.id}`).set(auth);
  check(rDelCli.status === 400, "DELETE nuestro cliente → 400 (bloqueado)", `status=${rDelCli.status}`);

  // 5) DELETE demandado → 200. Como el fallback usa la primera otra parte, el título
  //    pasa al tercero que sigue (igual que el form al crear: DEMANDADO ?? primera otra).
  const r5 = await request(app).delete(`/procesos/${proc.id}/partes/${pedro.id}`).set(auth);
  check(r5.status === 200, "DELETE demandado → 200", `status=${r5.status}`);
  check(r5.body?.titulo === "Proceso Laboral — Sara vs. Tercero SA", "título cae al tercero restante (fallback)", `titulo=${r5.body?.titulo}`);
  // Al quitar también al tercero, el título vuelve a solo el cliente.
  const tercero = (r5.body?.partes ?? []).find((p: { rol: string }) => p.rol === "TERCERO");
  const r5b = await request(app).delete(`/procesos/${proc.id}/partes/${tercero.id}`).set(auth);
  check(r5b.body?.titulo === "Proceso Laboral — Sara", "sin contrapartes → título solo cliente", `titulo=${r5b.body?.titulo}`);

  // 6) Salvedad tituloManual: editar título a mano y luego agregar parte NO lo pisa.
  await request(app).patch(`/procesos/${proc.id}`).set(auth).send({ titulo: "Mi título a mano" });
  const r6 = await request(app).post(`/procesos/${proc.id}/partes`).set(auth)
    .send({ litigante: { nombre: "Otro Demandado", tipoPersona: "NATURAL", correos: [] }, rol: "DEMANDADO" });
  check(r6.status === 201, "POST tras título manual → 201", `status=${r6.status}`);
  check(r6.body?.titulo === "Mi título a mano", "título manual NO se sobreescribe", `titulo=${r6.body?.titulo}`);

  await limpiar();
  console.log(`\n── Resultado: ${ok} ✓ / ${fail} ✗ ──\n`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
