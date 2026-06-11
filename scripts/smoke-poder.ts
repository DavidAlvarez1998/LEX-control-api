/**
 * Smoke en vivo del PODER en Derecho de Petición.
 *  pnpm --dir lex-control-api exec tsx scripts/smoke-poder.ts
 *
 * Crea una empresa desechable + admin de empresa + un proceso DdP (requierePoder=Sí)
 * vía prisma, y sobre la API real (supertest):
 *  1) confirma que el proceso no tiene poder,
 *  2) intenta AVANZAR a radicación SIN poder (observa el gate),
 *  3) sube el poder real a tecnovapp (POST /documentos/subir),
 *  4) confirma que GET /:id lo devuelve con URL pública,
 *  5) intenta AVANZAR de nuevo (observa el gate).
 * Limpia al final (la empresa + proceso; el archivo queda en tecnovapp demo).
 */
import request from "supertest";
import { prisma } from "../src/index";
import { createApp } from "../src/app";
import { hashPassword } from "../src/modules/auth/auth.service";
import { etapaEntrada, type EtapaDef } from "../src/modules/procesos/esquema";

const RFC = "SMOKE-PODER";
const PASS = "Smoke123!";
const app = createApp();

// PDF mínimo válido (cabecera + %%EOF) para subir como poder.
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

async function limpiar() {
  const emp = await prisma.empresa.findUnique({ where: { rfc: RFC }, select: { id: true } });
  if (!emp) return;
  await prisma.empresa.delete({ where: { id: emp.id } }); // cascade → usuarios, procesos, documentos
}

async function main() {
  await limpiar();

  const tipo = await prisma.tipoProceso.findFirst({
    where: { empresaId: null, nombre: { contains: "etici" } },
    select: { id: true, esquemaVersion: true, jurisdiccion: true, etapas: true },
  });
  if (!tipo) throw new Error("No existe el TipoProceso de Derecho de Petición (seed catálogo).");
  const entrada = etapaEntrada(tipo.etapas as unknown as EtapaDef[])!;

  const empresa = await prisma.empresa.create({ data: { nombre: "SMOKE Poder", rfc: RFC, activo: true } });
  const admin = await prisma.usuario.create({
    data: { email: "admin@smoke-poder.local", nombre: "Admin Poder", password: await hashPassword(PASS), rol: "USUARIO", empresaId: empresa.id, esAdminEmpresa: true },
  });

  // Proceso DdP en la etapa de entrada, con requierePoder=Sí y los datos de radicación listos.
  const proceso = await prisma.proceso.create({
    data: {
      empresaId: empresa.id,
      tipoProcesoId: tipo.id,
      tipoEsquemaVersion: tipo.esquemaVersion,
      jurisdiccion: tipo.jurisdiccion,
      codigoInterno: "DDP-SMOKE-0001",
      titulo: "Petición de prueba",
      etapaActual: entrada.key,
      creadoPorId: admin.id,
      datos: {
        requierePoder: true,
        entidad: "Alcaldía X",
        tipoPeticion: "General",
        queSolicita: ["Copia de documentos"],
        detalle: "Solicito copia.",
        fechaRadicacion: "2026-06-11",
        nroRadicado: "RAD-SMOKE-1",
      },
      historial: { create: { etapaKey: entrada.key, usuarioId: admin.id } },
    },
  });

  const tok = (await request(app).post("/auth/login").send({ email: admin.email, password: PASS, audience: "USUARIO" })).body.token;
  const auth = { Authorization: `Bearer ${tok}` };
  const log = (s: string) => console.log("  " + s);

  // Siguiente etapa real (orden 2) para intentar "avanzar".
  const ordenadas = (tipo.etapas as unknown as EtapaDef[]).slice().sort((a, b) => a.orden - b.orden);
  const siguiente = ordenadas.find((e) => e.orden === entrada.orden + 1) ?? ordenadas[1];

  console.log("\n── Smoke PODER (DdP) ──\n");

  // 1) Estado inicial.
  const r1 = await request(app).get(`/procesos/${proceso.id}`).set(auth);
  log(`1) GET /:id → ${r1.status} · documentos=${(r1.body.documentos ?? []).length} · requierePoder=${r1.body.datos?.requierePoder}`);

  // 2) Avanzar SIN poder.
  const r2 = await request(app).patch(`/procesos/${proceso.id}/etapa`).set(auth).send({ etapaKey: siguiente.key });
  const falt2 = r2.body?.error?.issues ?? r2.body?.error ?? r2.body;
  log(`2) PATCH etapa→${siguiente.key} SIN poder → ${r2.status} · ${JSON.stringify(falt2?.documentosFaltantes ?? falt2?.faltantes ?? falt2?.message ?? falt2)}`);

  // 3) Subir el poder (+ la petición, otra regla de radicada, para aislar el gate).
  const r3 = await request(app).post(`/procesos/${proceso.id}/documentos/subir`).set(auth).field("nombre", "poder.pdf").attach("file", PDF, "poder_original.pdf");
  await request(app).post(`/procesos/${proceso.id}/documentos/subir`).set(auth).field("nombre", "peticion.pdf").attach("file", PDF, "peticion.pdf");
  log(`3) POST /documentos/subir → ${r3.status} · nombre=${r3.body?.nombre} · url=${r3.body?.url}`);

  // 4) GET /:id otra vez.
  const r4 = await request(app).get(`/procesos/${proceso.id}`).set(auth);
  const docs4 = r4.body.documentos ?? [];
  log(`4) GET /:id → ${r4.status} · documentos=${docs4.length} · poder.url=${docs4.find((d: { nombre: string }) => d.nombre === "poder.pdf")?.url}`);

  // 5) Avanzar CON poder.
  const r5 = await request(app).patch(`/procesos/${proceso.id}/etapa`).set(auth).send({ etapaKey: siguiente.key });
  const falt5 = r5.body?.error?.issues ?? r5.body?.error ?? r5.body;
  log(`5) PATCH etapa→${siguiente.key} CON poder → ${r5.status} · ${JSON.stringify(falt5?.documentosFaltantes ?? falt5?.faltantes ?? falt5?.estado ?? falt5?.message ?? "")}`);

  console.log("");
  await limpiar();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n[smoke-poder] error:", e);
  await limpiar().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
