// Seed + backfill de los CIMIENTOS (módulos, permisos, planes, suscripciones,
// roles de empresa). Idempotente: se puede re-ejecutar. Ver
// openspec/changes/foundations-roles-plans-clientes/.
//   pnpm --dir lex-control-api seed:foundations
import { prisma } from "./index";
import { RolEmpresa } from "@prisma/client";

// --- Catálogo de módulos (baseline = siempre activo, no se siembra en planes) --
const MODULOS: { clave: string; nombre: string; esBaseline: boolean }[] = [
  { clave: "judicial", nombre: "Procesos judiciales", esBaseline: true },
  { clave: "extrajudicial", nombre: "Procesos extrajudiciales", esBaseline: true },
  { clave: "reportes", nombre: "Reportes", esBaseline: true },
  { clave: "calendario", nombre: "Calendario", esBaseline: true },
  { clave: "notificaciones", nombre: "Notificaciones", esBaseline: true },
  { clave: "export_excel", nombre: "Exportar a Excel", esBaseline: true },
  { clave: "contable", nombre: "Módulo contable", esBaseline: false },
  { clave: "comercial", nombre: "Módulo comercial", esBaseline: false },
  { clave: "contratos", nombre: "Módulo de contratos", esBaseline: false },
  { clave: "ia_redaccion", nombre: "Redacción de documentos", esBaseline: false },
  { clave: "logo_personalizado", nombre: "Logo personalizado", esBaseline: false },
  { clave: "automatizacion_contratos", nombre: "Automatización de contratos y poderes", esBaseline: false },
];

// --- Permisos mínimos de cimientos (Q7: set mínimo; cada módulo añade los suyos) -
const PERMISOS: { clave: string; nombre: string; modulo: string }[] = [
  { clave: "cliente.ver", nombre: "Ver clientes/prospectos", modulo: "comercial" },
  { clave: "cliente.crear", nombre: "Crear cliente/prospecto", modulo: "comercial" },
  { clave: "cliente.editar", nombre: "Editar cliente/prospecto", modulo: "comercial" },
  { clave: "cliente.convertir", nombre: "Convertir prospecto en cliente", modulo: "comercial" },
];
// Matriz RBAC por defecto: qué rol concede cada permiso (ADMINISTRADOR igual lo
// corta por short-circuit, pero se siembra explícito).
const RBAC: Record<string, RolEmpresa[]> = {
  // CONTABLE incluido (solo lectura): facturar exige elegir un cliente (la vista
  // /facturacion carga el listado para el desplegable).
  // JURIDICO incluido (ver/crear/editar/convertir): el abogado ve TODA la cartera
  // del despacho (cobertura + chequeo de conflictos de interés, estándar Clio/MyCase)
  // y puede registrar/editar/activar clientes — el abogado que hace el intake puede
  // convertir su propio prospecto sin depender de un comercial.
  "cliente.ver": [RolEmpresa.ADMINISTRADOR, RolEmpresa.COMERCIAL, RolEmpresa.CONTABLE, RolEmpresa.JURIDICO],
  "cliente.crear": [RolEmpresa.ADMINISTRADOR, RolEmpresa.COMERCIAL, RolEmpresa.JURIDICO],
  "cliente.editar": [RolEmpresa.ADMINISTRADOR, RolEmpresa.COMERCIAL, RolEmpresa.JURIDICO],
  "cliente.convertir": [RolEmpresa.ADMINISTRADOR, RolEmpresa.COMERCIAL, RolEmpresa.JURIDICO],
};

// --- Permisos del módulo COMERCIAL (set lean, claves CONCRETAS — requirePermiso
//     no soporta wildcards). Ver openspec/changes/comercial-funnel/. asignar y
//     rechazar son solo-ADMINISTRADOR; el resto ADMINISTRADOR + COMERCIAL. ---
const COMERCIAL: { clave: string; nombre: string; soloAdmin?: boolean }[] = [
  { clave: "comercial.seguimiento.ver", nombre: "Ver seguimientos" },
  { clave: "comercial.seguimiento.crear", nombre: "Crear seguimiento" },
  { clave: "comercial.seguimiento.editar", nombre: "Editar/cerrar seguimiento" },
  { clave: "comercial.fase.ver", nombre: "Ver fases del embudo" },
  { clave: "comercial.fase.mover", nombre: "Mover de fase" },
  { clave: "comercial.cotizacion.ver", nombre: "Ver cotizaciones" },
  { clave: "comercial.cotizacion.crear", nombre: "Crear cotización" },
  { clave: "comercial.cotizacion.editar", nombre: "Editar cotización" },
  { clave: "comercial.contrato.ver", nombre: "Ver contratos" },
  { clave: "comercial.contrato.crear", nombre: "Crear contrato/poder" },
  { clave: "comercial.contrato.editar", nombre: "Editar contrato (incl. firmar)" },
  { clave: "comercial.cobro.ver", nombre: "Ver plan de cobro" },
  { clave: "comercial.cobro.configurar", nombre: "Configurar plan de cobro" },
  { clave: "comercial.solicitud.ver", nombre: "Ver solicitudes de asignación" },
  { clave: "comercial.solicitud.crear", nombre: "Crear solicitud de asignación" },
  { clave: "comercial.solicitud.asignar", nombre: "Asignar proceso a abogado", soloAdmin: true },
  { clave: "comercial.solicitud.rechazar", nombre: "Rechazar solicitud", soloAdmin: true },
  { clave: "comercial.alertas.ver", nombre: "Ver alertas comerciales" },
  // Comisiones internas del despacho (MANUAL): el ADMINISTRADOR las registra/edita;
  // el COMERCIAL solo VE (acotado a sí mismo en el router). Ver comercial-rol-portal.
  { clave: "comercial.comision.ver", nombre: "Ver comisiones del despacho" },
  { clave: "comercial.comision.crear", nombre: "Registrar comisión", soloAdmin: true },
  { clave: "comercial.comision.editar", nombre: "Editar comisión", soloAdmin: true },
];
for (const c of COMERCIAL) {
  PERMISOS.push({ clave: c.clave, nombre: c.nombre, modulo: "comercial" });
  RBAC[c.clave] = c.soloAdmin
    ? [RolEmpresa.ADMINISTRADOR]
    : [RolEmpresa.ADMINISTRADOR, RolEmpresa.COMERCIAL];
}

// --- Permisos del módulo CONTABLE (claves CONCRETAS; toda la que use un router
//     DEBE estar aquí o requirePermiso da 500). RBAC: ADMINISTRADOR + CONTABLE.
//     Ver openspec/changes/contable-module/. ---
const CONTABLE: { clave: string; nombre: string }[] = [
  { clave: "contable.ingreso.ver", nombre: "Ver ingresos" },
  { clave: "contable.ingreso.crear", nombre: "Registrar ingreso" },
  { clave: "contable.egreso.ver", nombre: "Ver egresos" },
  { clave: "contable.egreso.crear", nombre: "Registrar egreso" },
  { clave: "contable.egreso.editar", nombre: "Editar egreso" },
  { clave: "contable.nomina.ver", nombre: "Ver nómina" },
  { clave: "contable.nomina.crear", nombre: "Registrar nómina" },
  { clave: "contable.nomina.editar", nombre: "Editar nómina" },
  { clave: "contable.cajamenor.ver", nombre: "Ver caja menor" },
  { clave: "contable.cajamenor.crear", nombre: "Crear caja / movimiento" },
  { clave: "contable.cajamenor.editar", nombre: "Editar caja menor" },
  { clave: "contable.serviciofijo.ver", nombre: "Ver servicios fijos" },
  { clave: "contable.serviciofijo.crear", nombre: "Registrar servicio fijo" },
  { clave: "contable.serviciofijo.editar", nombre: "Editar servicio fijo" },
  { clave: "contable.cuenta.ver", nombre: "Ver cuentas/bolsas" },
  { clave: "contable.cuenta.crear", nombre: "Crear cuenta/bolsa" },
  { clave: "contable.cuenta.editar", nombre: "Editar cuenta/bolsa" },
  { clave: "contable.cartera.ver", nombre: "Ver cartera" },
  { clave: "contable.cartera.resync", nombre: "Re-sincronizar total de cartera" },
  { clave: "contable.reporte.ver", nombre: "Ver reportes" },
];
for (const c of CONTABLE) {
  PERMISOS.push({ clave: c.clave, nombre: c.nombre, modulo: "contable" });
  RBAC[c.clave] = [RolEmpresa.ADMINISTRADOR, RolEmpresa.CONTABLE];
}

// --- Facturación: la factura formal al cliente. Vive bajo el módulo "contable"
//     (es parte de la contabilidad → no necesita un entitlement nuevo).
//     Ver openspec/changes/facturacion-module/. ---
const FACTURACION: { clave: string; nombre: string }[] = [
  { clave: "facturacion.factura.ver", nombre: "Ver facturas" },
  { clave: "facturacion.factura.gestionar", nombre: "Gestionar facturas (crear/emitir/pagar/anular)" },
];
for (const f of FACTURACION) {
  PERMISOS.push({ clave: f.clave, nombre: f.nombre, modulo: "contable" });
  RBAC[f.clave] = [RolEmpresa.ADMINISTRADOR, RolEmpresa.CONTABLE];
}

// --- Procesos (módulo "judicial", baseline → siempre habilitado; solo aplica la
//     puerta RBAC). Lectura: JURIDICO + COMERCIAL (para ver el caso de su cliente) +
//     ADMINISTRADOR. Escritura: solo JURIDICO + ADMINISTRADOR. Ver comercial-rol-portal. ---
const JUDICIAL: { clave: string; nombre: string; editar?: boolean }[] = [
  { clave: "proceso.ver", nombre: "Ver procesos" },
  { clave: "proceso.editar", nombre: "Editar procesos", editar: true },
];
for (const j of JUDICIAL) {
  PERMISOS.push({ clave: j.clave, nombre: j.nombre, modulo: "judicial" });
  RBAC[j.clave] = j.editar
    ? [RolEmpresa.JURIDICO, RolEmpresa.ADMINISTRADOR]
    : [RolEmpresa.JURIDICO, RolEmpresa.COMERCIAL, RolEmpresa.ADMINISTRADOR];
}

// --- Planes (precioMensual COP congelado; bufete_pro = valor COP de 1 SMMLV 2025).
//     `cuotas`: solo se siembran las sillas que el plan concede (ausente = cap 0).
//     `modulos`: solo los NO-baseline. limite null = ilimitado.
const PLANES: {
  clave: string; nombre: string; precio: number; orden: number;
  modulos: string[]; cuotas: Partial<Record<RolEmpresa, number | null>>;
  activo?: boolean; // ausente = true. trial = oculto del catálogo público.
}[] = [
  {
    // Plan de arranque para altas autoservicio desde la landing ("Crea tu cuenta").
    // activo:false → NO aparece en GET /publico/planes (precios), pero resolverPlanTrial lo
    // encuentra por clave. Ver openspec/changes/cuenta-autoservicio-empresa.
    // DECISIÓN 2026-06-27: el trial da acceso COMPLETO — todos los módulos + cupos
    // ilimitados (null) en los 4 roles — para que el usuario pruebe la plataforma entera
    // sin topes. (Antes era baseline-only + 1 admin + 1 jurídico.)
    clave: "trial", nombre: "Prueba gratis", precio: 0, orden: 0, activo: false,
    modulos: ["contable", "comercial", "contratos", "ia_redaccion", "logo_personalizado", "automatizacion_contratos"],
    cuotas: { ADMINISTRADOR: null, JURIDICO: null, CONTABLE: null, COMERCIAL: null },
  },
  {
    clave: "independiente", nombre: "Abogado independiente", precio: 200000, orden: 1,
    modulos: [],
    cuotas: { ADMINISTRADOR: 1, JURIDICO: 1 },
  },
  {
    clave: "independiente_pro", nombre: "Abogado independiente PRO", precio: 300000, orden: 2,
    modulos: ["contable", "comercial"],
    cuotas: { ADMINISTRADOR: 1, JURIDICO: 2, CONTABLE: 1, COMERCIAL: 1 },
  },
  {
    clave: "firma", nombre: "Firma", precio: 500000, orden: 3,
    modulos: ["contable", "comercial", "contratos"],
    cuotas: { ADMINISTRADOR: 1, JURIDICO: 5, CONTABLE: 1, COMERCIAL: 1 },
  },
  {
    clave: "bufete", nombre: "Bufete", precio: 1000000, orden: 4,
    modulos: ["contable", "comercial", "contratos", "logo_personalizado"],
    cuotas: { ADMINISTRADOR: 1, JURIDICO: 10, CONTABLE: 1, COMERCIAL: 1 },
  },
  {
    clave: "bufete_pro", nombre: "Bufete PRO", precio: 1423500, orden: 5,
    modulos: ["contable", "comercial", "contratos", "logo_personalizado", "ia_redaccion", "automatizacion_contratos"],
    cuotas: { ADMINISTRADOR: 2, JURIDICO: null, CONTABLE: null, COMERCIAL: null }, // ilimitado
  },
];

const GRANDFATHER_PLAN = "firma"; // plan de arranque para empresas existentes

async function main() {
  // 1) Módulos
  for (const m of MODULOS) {
    await prisma.modulo.upsert({
      where: { clave: m.clave },
      update: { nombre: m.nombre, esBaseline: m.esBaseline },
      create: m,
    });
  }
  const modulos = await prisma.modulo.findMany();
  const moduloId = new Map(modulos.map((m) => [m.clave, m.id]));

  // 2) Permisos + 3) matriz RBAC
  for (const p of PERMISOS) {
    const permiso = await prisma.permiso.upsert({
      where: { clave: p.clave },
      update: { nombre: p.nombre, moduloId: moduloId.get(p.modulo)! },
      create: { clave: p.clave, nombre: p.nombre, moduloId: moduloId.get(p.modulo)! },
    });
    for (const rol of RBAC[p.clave] ?? []) {
      await prisma.rolEmpresaPermiso.upsert({
        where: { rolEmpresa_permisoId: { rolEmpresa: rol, permisoId: permiso.id } },
        update: {},
        create: { rolEmpresa: rol, permisoId: permiso.id },
      });
    }
  }

  // 4) Planes + sus módulos no-baseline + cuotas
  for (const pl of PLANES) {
    const plan = await prisma.plan.upsert({
      where: { clave: pl.clave },
      update: { nombre: pl.nombre, precioMensual: pl.precio, orden: pl.orden, activo: pl.activo ?? true },
      create: { clave: pl.clave, nombre: pl.nombre, precioMensual: pl.precio, orden: pl.orden, activo: pl.activo ?? true },
    });
    for (const mClave of pl.modulos) {
      await prisma.planModulo.upsert({
        where: { planId_moduloId: { planId: plan.id, moduloId: moduloId.get(mClave)! } },
        update: {},
        create: { planId: plan.id, moduloId: moduloId.get(mClave)! },
      });
    }
    for (const [rol, limite] of Object.entries(pl.cuotas)) {
      await prisma.planCuota.upsert({
        where: { planId_rolEmpresa: { planId: plan.id, rolEmpresa: rol as RolEmpresa } },
        update: { limite: limite ?? null },
        create: { planId: plan.id, rolEmpresa: rol as RolEmpresa, limite: limite ?? null },
      });
    }
  }

  // 5) BACKFILL — cada empresa → Suscripción al plan de arranque (firma)
  const firma = await prisma.plan.findUniqueOrThrow({ where: { clave: GRANDFATHER_PLAN } });
  const empresas = await prisma.empresa.findMany({ select: { id: true } });
  for (const e of empresas) {
    await prisma.suscripcion.upsert({
      where: { empresaId: e.id },
      update: {}, // no piso una suscripción ya existente
      create: { empresaId: e.id, planId: firma.id, estado: "ACTIVA" },
    });
  }

  // 6) BACKFILL — cada USUARIO de empresa → ≥1 rol (admin⇒ADMINISTRADOR, else JURIDICO)
  const usuarios = await prisma.usuario.findMany({
    where: { rol: "USUARIO", empresaId: { not: null } },
    select: { id: true, empresaId: true, esAdminEmpresa: true },
  });
  for (const u of usuarios) {
    const rolEmpresa = u.esAdminEmpresa ? RolEmpresa.ADMINISTRADOR : RolEmpresa.JURIDICO;
    await prisma.usuarioRolEmpresa.upsert({
      where: { usuarioId_rolEmpresa: { usuarioId: u.id, rolEmpresa } },
      update: {},
      create: { usuarioId: u.id, rolEmpresa, empresaId: u.empresaId! },
    });
  }

  // 7) BACKFILL — agenda comercial: el dueño de un seguimiento previo = quien lo
  //    registró. Solo toca filas sin comercialId (idempotente). Ver comercial-rol-portal.
  const seguimientosBackfilled = await prisma.$executeRaw`
    UPDATE seguimientos_comerciales
    SET comercialId = registradoPorId
    WHERE comercialId IS NULL AND registradoPorId IS NOT NULL`;

  console.log(
    JSON.stringify({
      seguimientosBackfilled,
      modulos: await prisma.modulo.count(),
      permisos: await prisma.permiso.count(),
      rolEmpresaPermisos: await prisma.rolEmpresaPermiso.count(),
      planes: await prisma.plan.count(),
      planModulos: await prisma.planModulo.count(),
      planCuotas: await prisma.planCuota.count(),
      suscripciones: await prisma.suscripcion.count(),
      usuarioRolesEmpresa: await prisma.usuarioRolEmpresa.count(),
      empresasSinSuscripcion: empresas.length - (await prisma.suscripcion.count()),
    }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
