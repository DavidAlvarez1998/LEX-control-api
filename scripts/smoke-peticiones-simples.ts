/** Smoke de las peticiones "simples" (Reclamación Administrativa + Constitución de
 *  Renuencia): confirma que el flujo de creación genérico funciona end-to-end para
 *  estos dos tipos (estaban marcados como "faltantes" pero ya están cableados).
 *  pnpm exec tsx scripts/smoke-peticiones-simples.ts */
import request from "supertest";
import { prisma } from "../src/index";
import { createApp } from "../src/app";
import { hashPassword, signToken } from "../src/modules/auth/auth.service";
import type { EtapaDef, CampoEsquema } from "../src/modules/procesos/esquema";

// Rellena un valor de prueba para cada campo REQUERIDO del esquema (como el form).
function datosDePrueba(esquema: CampoEsquema[]): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  for (const c of esquema) {
    if (!c.requerido) continue;
    switch (c.tipo) {
      case "select": d[c.key] = c.opciones?.[0] ?? "x"; break;
      case "multiselect": d[c.key] = [c.opciones?.[0] ?? "x"]; break;
      case "fecha": d[c.key] = "2026-06-18"; break;
      case "numero": d[c.key] = "1"; break;
      case "boolean": d[c.key] = true; break;
      default: d[c.key] = "Prueba smoke";
    }
  }
  return d;
}

const RFC = "SMOKE-PET-SIMPLES";
const app = createApp();
const PASS = "Smoke123!";
let ok = 0, fail = 0;
const log = (s: string) => console.log("  " + s);
const check = (cond: boolean, label: string, extra = "") => {
  cond ? ok++ : fail++;
  log(`${cond ? "✓" : "✗ FALLO"} ${label}${extra ? " · " + extra : ""}`);
};

async function limpiar() {
  const e = await prisma.empresa.findUnique({ where: { rfc: RFC }, select: { id: true } });
  if (!e) return;
  await prisma.proceso.deleteMany({ where: { empresaId: e.id } });
  await prisma.litigante.deleteMany({ where: { empresaId: e.id } });
  await prisma.empresa.delete({ where: { id: e.id } });
}

async function main() {
  await limpiar();
  console.log("\n── Smoke PETICIONES SIMPLES (reclamación + renuencia) ──\n");

  const empresa = await prisma.empresa.create({ data: { nombre: "SMOKE PetSimples", rfc: RFC, activo: true } });
  const admin = await prisma.usuario.create({ data: { email: "admin@smoke-petsimples.local", nombre: "Admin", password: await hashPassword(PASS), rol: "USUARIO", empresaId: empresa.id, esAdminEmpresa: true } });
  const tok = signToken({ sub: admin.id, rol: "USUARIO", tv: admin.tokenVersion });
  const auth = { Authorization: `Bearer ${tok}` };

  for (const nombre of ["Reclamación Administrativa", "Constitución de Renuencia"]) {
    const tipo = await prisma.tipoProceso.findFirst({ where: { empresaId: null, nombre } });
    check(!!tipo, `tipo "${nombre}" existe en el catálogo`);
    if (!tipo) continue;
    const etapas = tipo.etapas as unknown as EtapaDef[];
    check(etapas.length > 0, `  tiene flujo (${etapas.length} etapas)`, etapas.map((e) => e.key).join(", "));

    // Crear vía la API genérica (igual que el form /peticiones/nueva?tipo=ID).
    const datos = datosDePrueba(tipo.esquemaFormulario as unknown as CampoEsquema[]);
    const r = await request(app).post("/procesos").set(auth).send({
      tipoProcesoId: tipo.id,
      titulo: `${nombre} — Prueba`,
      datos,
      cliente: { nuevo: { nombre: "Peticionario Smoke" }, rol: "OTRO", rolEtiqueta: "Peticionario" },
    });
    check(r.status === 201, `  POST /procesos → 201`, `status=${r.status} ${JSON.stringify(r.body?.error ?? "")}`);
    check(r.body?.tipoProceso?.nombre === nombre, `  proceso creado con el tipo correcto`);

    // Aparece en el listado filtrado (lo que hace _lista-peticion-simple).
    const list = await request(app).get(`/procesos?tipoProcesoId=${tipo.id}`).set(auth);
    const found = (list.body?.items ?? list.body ?? []).some?.((p: { id: string }) => p.id === r.body?.id);
    check(list.status === 200 && !!found, `  aparece en GET /procesos?tipoProcesoId`, `status=${list.status}`);
  }

  await limpiar();
  console.log(`\n── Resultado: ${ok} ✓ / ${fail} ✗ ──\n`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
