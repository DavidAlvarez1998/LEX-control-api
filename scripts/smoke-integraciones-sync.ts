/** Smoke e2e — integraciones-estatales Fase B (motor de sincronización).
 *  Ejerce contra la BD REAL: idempotencia, no-op sin radicado, proyección al
 *  timeline, proveedor deshabilitado, aislamiento cross-tenant (supertest),
 *  borrado en cascada, caché TTL y cifrado de credenciales.
 *  pnpm exec tsx scripts/smoke-integraciones-sync.ts */
import request from "supertest";
import { prisma } from "../src/index";
import { createApp } from "../src/app";
import { hashPassword, signToken } from "../src/modules/auth/auth.service";
import { sincronizarActuaciones } from "../src/modules/integraciones/actuacionesSync.service";
import { mockActuacionesAdapter } from "../src/modules/integraciones/mockActuaciones.client";
import { resolverProveedorActuaciones } from "../src/modules/integraciones/proveedores";
import type { ActuacionesProvider } from "../src/modules/integraciones/integraciones.types";

const RFC_A = "SMOKE-INTEG-A";
const RFC_B = "SMOKE-INTEG-B";
const PASS = "Smoke123!";
const app = createApp();

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

async function limpiar() {
  for (const rfc of [RFC_A, RFC_B]) {
    const e = await prisma.empresa.findUnique({ where: { rfc }, select: { id: true } });
    if (!e) continue;
    await prisma.integrationSyncLog.deleteMany({ where: { empresaId: e.id } });
    await prisma.providerConfig.deleteMany({ where: { empresaId: e.id } });
    // ActuacionJudicial + EtapaProceso caen por cascade al borrar el proceso/empresa.
    await prisma.empresa.delete({ where: { id: e.id } });
  }
}

async function crearEmpresaConProceso(rfc: string, radicado: string | null) {
  const ddp = await prisma.tipoProceso.findFirstOrThrow({ where: { empresaId: null } });
  const empresa = await prisma.empresa.create({ data: { nombre: `SMOKE ${rfc}`, rfc, activo: true } });
  const admin = await prisma.usuario.create({
    data: { email: `admin@${rfc.toLowerCase()}.local`, nombre: "Admin", password: await hashPassword(PASS), rol: "USUARIO", empresaId: empresa.id, esAdminEmpresa: true },
  });
  const proceso = await prisma.proceso.create({
    data: {
      empresaId: empresa.id, tipoProcesoId: ddp.id, tipoEsquemaVersion: ddp.esquemaVersion,
      jurisdiccion: ddp.jurisdiccion, codigoInterno: `${rfc}-1`, titulo: "Proceso smoke",
      radicado, creadoPorId: admin.id, etapaActual: "borrador",
      datos: {}, historial: { create: { etapaKey: "borrador", usuarioId: admin.id } },
    },
  });
  return { empresa, admin, proceso };
}

async function main() {
  await limpiar();
  const RADICADO = "11001310300120240012345";
  const A = await crearEmpresaConProceso(RFC_A, RADICADO);
  const B = await crearEmpresaConProceso(RFC_B, "05001310300120240067890");
  const procesoSinRad = await prisma.proceso.create({
    data: {
      empresaId: A.empresa.id, tipoProcesoId: A.proceso.tipoProcesoId, tipoEsquemaVersion: A.proceso.tipoEsquemaVersion,
      jurisdiccion: A.proceso.jurisdiccion, codigoInterno: `${RFC_A}-2`, titulo: "Sin radicado",
      radicado: null, creadoPorId: A.admin.id, etapaActual: "borrador", datos: {},
    },
  });

  console.log("\n── Smoke integraciones Fase B ──\n");

  // 1) Primera sync: crea N actuaciones + proyección al timeline.
  const r1 = await sincronizarActuaciones(A.proceso, mockActuacionesAdapter, { forzar: true });
  check("1ª sync OK con itemsNew>0", r1.estado === "OK" && r1.itemsNew > 0, r1);
  const guardadas = await prisma.actuacionJudicial.count({ where: { procesoId: A.proceso.id } });
  check("actuaciones persistidas == itemsNew", guardadas === r1.itemsNew, { guardadas, itemsNew: r1.itemsNew });
  const etapasProyectadas = await prisma.etapaProceso.count({ where: { procesoId: A.proceso.id, etapaKey: "actuacion-judicial" } });
  check("proyección al timeline: EtapaProceso(actuacion-judicial) por cada nueva", etapasProyectadas === r1.itemsNew, etapasProyectadas);
  const conEtapa = await prisma.actuacionJudicial.count({ where: { procesoId: A.proceso.id, etapaProcesoId: { not: null } } });
  check("cada actuación enlaza su etapaProcesoId", conEtapa === r1.itemsNew, conEtapa);

  // 2) Idempotencia: re-sync (forzar, mismo proveedor determinista) → itemsNew=0, sin duplicados.
  const r2 = await sincronizarActuaciones(A.proceso, mockActuacionesAdapter, { forzar: true });
  check("re-sync idempotente: itemsNew=0", r2.estado === "OK" && r2.itemsNew === 0, r2);
  const guardadas2 = await prisma.actuacionJudicial.count({ where: { procesoId: A.proceso.id } });
  check("sin filas duplicadas tras re-sync", guardadas2 === guardadas, { guardadas2, guardadas });

  // 3) Caché TTL: sin forzar y con sync OK reciente → fromCache=true, NO llama al proveedor.
  let llamadas = 0;
  const espia: ActuacionesProvider = {
    nombre: mockActuacionesAdapter.nombre,
    mode: mockActuacionesAdapter.mode,
    fetchActuaciones: async (rad) => { llamadas++; return mockActuacionesAdapter.fetchActuaciones(rad); },
  };
  const r3 = await sincronizarActuaciones(A.proceso, espia, {});
  check("on-demand dentro del TTL → fromCache=true", r3.fromCache === true && r3.estado === "OK", r3);
  check("caché: el proveedor NO fue llamado", llamadas === 0, llamadas);

  // 4) Proceso sin radicado → no-op SIN_RADICADO, proveedor NO llamado.
  let llamadas2 = 0;
  const espia2: ActuacionesProvider = { ...mockActuacionesAdapter, fetchActuaciones: async (r) => { llamadas2++; return mockActuacionesAdapter.fetchActuaciones(r); } };
  const r4 = await sincronizarActuaciones(procesoSinRad, espia2, { forzar: true });
  check("sin radicado → estado SIN_RADICADO", r4.estado === "SIN_RADICADO", r4);
  check("sin radicado → proveedor NO llamado", llamadas2 === 0, llamadas2);

  // 5) Proveedor deshabilitado para el despacho → resolver devuelve null.
  await prisma.providerConfig.create({ data: { empresaId: B.empresa.id, proveedor: "cpnu", habilitado: false } });
  const provB = await resolverProveedorActuaciones(B.empresa.id);
  check("ProviderConfig habilitado=false → proveedor omitido (null)", provB === null, provB?.nombre ?? null);
  const provA = await resolverProveedorActuaciones(A.empresa.id);
  check("sin config / habilitado → resuelve el mock", provA?.nombre === mockActuacionesAdapter.nombre, provA?.nombre ?? null);

  // 6) Aislamiento cross-tenant (supertest): admin de A no alcanza el proceso de B → 404.
  const tokA = signToken({ sub: A.admin.id, rol: "USUARIO", tv: A.admin.tokenVersion });
  const authA = { Authorization: `Bearer ${tokA}` };
  const xActu = await request(app).get(`/integraciones/procesos/${B.proceso.id}/actuaciones`).set(authA);
  check("GET actuaciones de otro despacho → 404", xActu.status === 404, xActu.status);
  const xSync = await request(app).post(`/integraciones/procesos/${B.proceso.id}/sincronizar`).set(authA);
  check("POST sincronizar de otro despacho → 404", xSync.status === 404, xSync.status);

  // 7) Endpoint sync on-demand del PROPIO proceso (forzar) → 200 con resumen.
  const okSync = await request(app).post(`/integraciones/procesos/${A.proceso.id}/sincronizar?forzar=true`).set(authA);
  check("POST sincronizar propio (forzar) → 200 OK", okSync.status === 200 && okSync.body.estado === "OK", { s: okSync.status, b: okSync.body });
  const lista = await request(app).get(`/integraciones/procesos/${A.proceso.id}/actuaciones`).set(authA);
  check("GET actuaciones propio → 200 con total>0", lista.status === 200 && lista.body.total > 0, { s: lista.status, t: lista.body?.total });

  // 8) Config de proveedor: la credencial se guarda CIFRADA (nunca en claro) y GET la oculta.
  const putCfg = await request(app).put("/integraciones/config/rues").set(authA).send({ habilitado: true, credencial: "API-KEY-SECRETA-123" });
  check("PUT config → 200 tieneCredencial=true", putCfg.status === 200 && putCfg.body.tieneCredencial === true, { s: putCfg.status, b: putCfg.body });
  const rowCfg = await prisma.providerConfig.findUnique({ where: { empresaId_proveedor: { empresaId: A.empresa.id, proveedor: "rues" } } });
  check("credencial NO se guarda en claro", !!rowCfg?.credencialCifrada && !rowCfg.credencialCifrada.includes("API-KEY-SECRETA-123"), rowCfg?.credencialCifrada?.slice(0, 12));
  const getCfg = await request(app).get("/integraciones/config").set(authA);
  check("GET config no expone la credencial", getCfg.status === 200 && getCfg.body.every((c: Record<string, unknown>) => !("credencialCifrada" in c)), getCfg.body);

  // 9) Borrado del proceso → sus actuaciones se eliminan (habeas data, cascade).
  await prisma.proceso.delete({ where: { id: A.proceso.id } });
  const tras = await prisma.actuacionJudicial.count({ where: { procesoId: A.proceso.id } });
  check("borrar proceso elimina sus actuaciones (cascade)", tras === 0, tras);

  console.log(`\n  Resultado: ${pass} ✅ / ${fail} ❌\n`);
  await limpiar();
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await limpiar().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
