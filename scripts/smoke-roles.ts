/**
 * Smoke por rol — comercial-rol-portal (RolEmpresa del despacho).
 *
 * Ejerce la cadena REAL end-to-end (login → puerta de módulo → RBAC) contra la
 * BD, con supertest sobre createApp(). Siembra una empresa desechable con 4
 * usuarios (admin de empresa / COMERCIAL / JURIDICO / COMERCIAL+JURIDICO), corre
 * la matriz de acceso de las 4 capacidades del rol COMERCIAL y limpia al final.
 *
 *   pnpm --dir lex-control-api exec tsx scripts/smoke-roles.ts
 *
 * Requiere que el RBAC esté sembrado (seed:foundations) y haya ≥1 plan + el
 * módulo `comercial`. NO toca datos existentes (empresa con rfc SMOKE-ROLES).
 */
import request from "supertest";
import { RolEmpresa } from "@prisma/client";
import { prisma } from "../src/index";
import { createApp } from "../src/app";
import { hashPassword } from "../src/modules/auth/auth.service";

const RFC = "SMOKE-ROLES"; // marca de la empresa desechable (idempotente)
const PASS = "Smoke123!";
const app = createApp();

type Rol = "admin" | "comercial" | "juridico" | "multi";

// ── Aserción de status: `expected` puede ser un número exacto o un predicado. ──
type Expect = number | { not: number; label: string };
const checks: { rol: Rol; name: string; got: number; expect: Expect; ok: boolean }[] = [];

function record(rol: Rol, name: string, got: number, expect: Expect) {
  const ok = typeof expect === "number" ? got === expect : got !== expect.not;
  checks.push({ rol, name, got, expect, ok });
}

async function limpiar() {
  const emp = await prisma.empresa.findUnique({ where: { rfc: RFC }, select: { id: true } });
  if (!emp) return;
  const empresaId = emp.id;
  // Tablas con empresaId desnormalizado (sin FK cascade) → borrar explícito.
  await prisma.cartera.deleteMany({ where: { empresaId } });
  await prisma.comisionDespacho.deleteMany({ where: { empresaId } });
  await prisma.seguimientoComercial.deleteMany({ where: { empresaId } });
  await prisma.usuarioRolEmpresa.deleteMany({ where: { empresaId } });
  // El resto (usuarios, clientes, suscripción) cae por cascade al borrar empresa.
  await prisma.empresa.delete({ where: { id: empresaId } });
}

async function sembrar() {
  const plan = await prisma.plan.findFirst({ select: { id: true } });
  const moduloComercial = await prisma.modulo.findUnique({ where: { clave: "comercial" }, select: { id: true } });
  const tipoProceso = await prisma.tipoProceso.findFirst({ where: { empresaId: null }, select: { id: true } });
  if (!plan || !moduloComercial || !tipoProceso) {
    throw new Error("Falta seed: se necesitan ≥1 plan, módulo `comercial` y un TipoProceso global. Corre seed:foundations + seed:catalogo.");
  }

  const empresa = await prisma.empresa.create({ data: { nombre: "SMOKE Roles", rfc: RFC, activo: true } });
  const empresaId = empresa.id;

  // Suscripción ACTIVA + override que habilita el módulo comercial (judicial es baseline).
  await prisma.suscripcion.create({
    data: {
      empresaId,
      planId: plan.id,
      estado: "ACTIVA",
      modulos: { create: { moduloId: moduloComercial.id, habilitado: true } },
    },
  });

  const password = await hashPassword(PASS);
  const mk = (key: Rol, esAdminEmpresa: boolean) =>
    prisma.usuario.create({
      data: { email: `${key}@smoke.local`, nombre: `Smoke ${key}`, password, rol: "USUARIO", empresaId, esAdminEmpresa },
    });
  const usuarios: Record<Rol, { id: string }> = {
    admin: await mk("admin", true),
    comercial: await mk("comercial", false),
    juridico: await mk("juridico", false),
    multi: await mk("multi", false),
  };

  // Roles de empresa (el admin no necesita UsuarioRolEmpresa: esAdminEmpresa corta la puerta RBAC).
  const rol = (usuarioId: string, r: RolEmpresa) =>
    prisma.usuarioRolEmpresa.create({ data: { usuarioId, empresaId, rolEmpresa: r } });
  await rol(usuarios.comercial.id, RolEmpresa.COMERCIAL);
  await rol(usuarios.juridico.id, RolEmpresa.JURIDICO);
  await rol(usuarios.multi.id, RolEmpresa.COMERCIAL);
  await rol(usuarios.multi.id, RolEmpresa.JURIDICO);

  // Un cliente del comercial (para cartera + alcance de procesos) y una fila de cartera.
  const cliente = await prisma.cliente.create({
    data: { empresaId, nombre: "Cliente Smoke", estado: "CLIENTE", responsableComercialId: usuarios.comercial.id },
  });
  await prisma.cartera.create({
    data: { empresaId, clienteId: cliente.id, tipoCobro: "FIJO", valorTotalAcordado: 1_000_000 },
  });

  return { clienteId: cliente.id, tipoProcesoId: tipoProceso.id };
}

async function login(key: Rol): Promise<string> {
  const res = await request(app).post("/auth/login").send({ email: `${key}@smoke.local`, password: PASS, audience: "USUARIO" });
  if (res.status !== 200) throw new Error(`Login ${key} falló (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function main() {
  await limpiar();
  const { clienteId, tipoProcesoId } = await sembrar();
  void tipoProcesoId;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const tokens: Record<Rol, string> = {
    admin: await login("admin"),
    comercial: await login("comercial"),
    juridico: await login("juridico"),
    multi: await login("multi"),
  };

  // Matriz esperada por rol (status HTTP). NEG = no debe ser 403 (permiso concedido,
  // aunque el body luego sea inválido → 400). Ver comercial-rol-portal.
  const NEG: Expect = { not: 403, label: "≠403" };
  // NOTA: la agenda dejó de ser COMERCIAL-only. El change `client-agenda-universal`
  // (posterior, ya aplicado/archivado) la volvió BASELINE (`requireAuth`): cualquier
  // usuario del despacho —incl. JURIDICO o un USUARIO sin rol— accede a `/comercial/agenda`
  // (200). Por eso aquí agenda.ver = 200 para todos los roles.
  const matriz: Record<Rol, Record<string, Expect>> = {
    //                          comisiones.ver  comisiones.crear  cartera.ver  agenda.ver  procesos.ver  procesos.write
    comercial: { "GET /comercial/comisiones": 200, "POST /comercial/comisiones": 403, "GET cartera": 200, "GET /comercial/agenda": 200, "GET /procesos": 200, "POST /procesos": 403 },
    juridico:  { "GET /comercial/comisiones": 403, "POST /comercial/comisiones": 403, "GET cartera": 403, "GET /comercial/agenda": 200, "GET /procesos": 200, "POST /procesos": NEG },
    multi:     { "GET /comercial/comisiones": 200, "POST /comercial/comisiones": 403, "GET cartera": 200, "GET /comercial/agenda": 200, "GET /procesos": 200, "POST /procesos": NEG },
    admin:     { "GET /comercial/comisiones": 200, "POST /comercial/comisiones": NEG, "GET cartera": 200, "GET /comercial/agenda": 200, "GET /procesos": 200, "POST /procesos": NEG },
  };

  for (const rol of Object.keys(matriz) as Rol[]) {
    const t = tokens[rol];
    const m = matriz[rol];
    record(rol, "GET /comercial/comisiones", (await request(app).get("/comercial/comisiones").set(auth(t))).status, m["GET /comercial/comisiones"]);
    record(rol, "POST /comercial/comisiones", (await request(app).post("/comercial/comisiones").set(auth(t)).send({})).status, m["POST /comercial/comisiones"]);
    record(rol, "GET cartera", (await request(app).get(`/comercial/clientes/${clienteId}/cartera`).set(auth(t))).status, m["GET cartera"]);
    record(rol, "GET /comercial/agenda", (await request(app).get("/comercial/agenda").set(auth(t))).status, m["GET /comercial/agenda"]);
    record(rol, "GET /procesos", (await request(app).get("/procesos").set(auth(t))).status, m["GET /procesos"]);
    record(rol, "POST /procesos", (await request(app).post("/procesos").set(auth(t)).send({})).status, m["POST /procesos"]);
  }

  // 401 sin token (sanidad de la puerta de auth).
  record("comercial", "GET /procesos (sin token)", (await request(app).get("/procesos")).status, 401);

  await limpiar();

  // ── Reporte ──
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log("\n  ROL        ENDPOINT                         GOT   ESPERADO   ");
  console.log("  " + "─".repeat(64));
  for (const c of checks) {
    const exp = typeof c.expect === "number" ? String(c.expect) : c.expect.label;
    console.log(`  ${c.ok ? "✓" : "✗"} ${pad(c.rol, 9)} ${pad(c.name, 31)} ${pad(String(c.got), 5)} ${pad(exp, 8)}`);
  }
  const fallidos = checks.filter((c) => !c.ok);
  console.log("  " + "─".repeat(64));
  console.log(`\n  ${checks.length - fallidos.length}/${checks.length} OK${fallidos.length ? ` — ${fallidos.length} FALLIDOS` : " — TODO VERDE ✅"}\n`);
  await prisma.$disconnect();
  process.exit(fallidos.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error("\n[smoke-roles] error:", e);
  await limpiar().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
