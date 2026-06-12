// Módulo CONTABLE. Tenant-scoped igual que clientes/comercial (empresaId del
// token, hard WHERE, assertSameEmpresa) + requirePermiso con claves CONCRETAS.
// LEE el plan de cobro del comercial (ConfiguracionCobro), nunca lo reescribe.
// Saldos DERIVADOS al leer, nunca guardados. Ver openspec/changes/contable-module/.
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { empresaIdRequerido, requireAuth, requirePermiso } from "../../middleware/auth";
import { HttpError } from "../../middleware/error";
import { validate } from "../../middleware/validate";
import {
  createCajaSchema, createCarteraSchema, createCuentaSchema, createEgresoSchema,
  createIngresoSchema, createMovimientoSchema, createNominaSchema, createServicioFijoSchema,
  createServicioFijoRecurrenteSchema, generarServiciosFijosSchema,
  idParams, reporteQuery, updateCajaSchema, updateCuentaSchema, updateEgresoSchema,
  updateNominaSchema, updateServicioFijoSchema, updateServicioFijoRecurrenteSchema,
} from "./contable.schemas";

import { conSaldo, n } from "./cartera.service";

export const contableRoutes: Router = Router();

// --- validadores same-empresa (las FK son escalares sin constraint en BD) ---
async function assertCliente(empresaId: string, clienteId: string) {
  if (!(await prisma.cliente.findFirst({ where: { id: clienteId, empresaId }, select: { id: true } })))
    throw new HttpError(400, "El cliente no pertenece a tu empresa");
}
async function procesoRadicado(empresaId: string, procesoId: string): Promise<string | null> {
  const p = await prisma.proceso.findFirst({ where: { id: procesoId, empresaId }, select: { radicado: true } });
  if (!p) throw new HttpError(400, "El proceso no pertenece a tu empresa");
  return p.radicado;
}
async function assertCuenta(empresaId: string, cuentaId: string) {
  if (!(await prisma.cuentaBancaria.findFirst({ where: { id: cuentaId, empresaId }, select: { id: true } })))
    throw new HttpError(400, "La cuenta no pertenece a tu empresa");
}
// La nómina referencia al empleado por escalar (sin FK): debe ser personal del
// MISMO despacho. Un ADMIN de plataforma (empresaId null) nunca casa con el
// empresaId del token → no puede ser sujeto de nómina. Ver spec contable-nomina.
async function assertEmpleado(empresaId: string, empleadoId: string) {
  if (!(await prisma.usuario.findFirst({ where: { id: empleadoId, empresaId }, select: { id: true } })))
    throw new HttpError(400, "El empleado no pertenece a tu empresa");
}

// ===================== INGRESOS (append-only) =====================
contableRoutes.get("/ingresos", requireAuth, requirePermiso("contable.ingreso.ver"),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { clienteId, procesoId } = req.query as Record<string, string | undefined>;
    res.json(await prisma.ingreso.findMany({
      where: { empresaId, ...(clienteId ? { clienteId } : {}), ...(procesoId ? { procesoId } : {}) },
      orderBy: { fechaIngreso: "desc" },
    }));
  }));

contableRoutes.post("/ingresos", requireAuth, requirePermiso("contable.ingreso.crear"),
  validate({ body: createIngresoSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const b = req.body;
    await assertCliente(empresaId, b.clienteId);
    let radicado: string | null = null;
    if (b.procesoId) radicado = await procesoRadicado(empresaId, b.procesoId);
    if (b.cuentaId) await assertCuenta(empresaId, b.cuentaId);
    const ingreso = await prisma.ingreso.create({
      data: { ...b, empresaId, radicado, registradoPorId: req.user!.sub },
    });
    res.status(201).json(ingreso);
  }));

// ===================== EGRESOS =====================
contableRoutes.get("/egresos", requireAuth, requirePermiso("contable.egreso.ver"),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { categoria, procesoId } = req.query as Record<string, string | undefined>;
    res.json(await prisma.egreso.findMany({
      where: { empresaId, ...(categoria ? { categoriaGasto: categoria as never } : {}), ...(procesoId ? { procesoId } : {}) },
      orderBy: { fechaGasto: "desc" },
    }));
  }));

contableRoutes.post("/egresos", requireAuth, requirePermiso("contable.egreso.crear"),
  validate({ body: createEgresoSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const b = req.body;
    if (b.clienteId) await assertCliente(empresaId, b.clienteId);
    let radicado: string | null = null;
    if (b.procesoId) radicado = await procesoRadicado(empresaId, b.procesoId);
    if (b.cuentaId) await assertCuenta(empresaId, b.cuentaId);
    res.status(201).json(await prisma.egreso.create({
      data: { ...b, empresaId, radicado, registradoPorId: req.user!.sub },
    }));
  }));

contableRoutes.patch("/egresos/:id", requireAuth, requirePermiso("contable.egreso.editar"),
  validate({ params: idParams, body: updateEgresoSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    if (req.body.cuentaId) await assertCuenta(empresaId, req.body.cuentaId);
    const { count } = await prisma.egreso.updateMany({ where: { id: req.params.id, empresaId }, data: req.body });
    if (count === 0) throw new HttpError(404, "Egreso no encontrado");
    res.json(await prisma.egreso.findUnique({ where: { id: req.params.id } }));
  }));

// ===================== NÓMINA =====================
contableRoutes.get("/nominas", requireAuth, requirePermiso("contable.nomina.ver"),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { periodo } = req.query as Record<string, string | undefined>;
    res.json(await prisma.nomina.findMany({
      where: { empresaId, ...(periodo ? { periodo } : {}) }, orderBy: { periodo: "desc" },
    }));
  }));

// GET /nominas/empleables — proyección MÍNIMA de los contratos del despacho para
// prellenar la nómina. Segregación de funciones: el contable ve solo lo que
// necesita para pagar (nombre/cargo/honorarios/tipo/fecha/estado), NUNCA el
// contrato completo (cláusulas, documentos, datos legales). NO requiere
// contrato.ver; se gobierna con contable.nomina.crear. Incluye `estado` para que
// el front muestre vigentes por defecto pero permita finalizados (liquidación).
contableRoutes.get("/nominas/empleables", requireAuth, requirePermiso("contable.nomina.crear"),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const contratos = await prisma.contrato.findMany({
      where: { empresaId },
      select: {
        id: true, usuarioId: true, nombreCompleto: true, cargo: true,
        honorarios: true, tipoContrato: true, fechaInicio: true, estado: true,
      },
      orderBy: [{ estado: "asc" }, { nombreCompleto: "asc" }],
    });
    res.json(contratos.map((c) => ({
      contratoId: c.id, usuarioId: c.usuarioId, nombre: c.nombreCompleto,
      cargo: c.cargo, honorarios: c.honorarios, tipoContrato: c.tipoContrato,
      fechaInicio: c.fechaInicio, estado: c.estado,
    })));
  }));

contableRoutes.post("/nominas", requireAuth, requirePermiso("contable.nomina.crear"),
  validate({ body: createNominaSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    if (req.body.empleadoId) await assertEmpleado(empresaId, req.body.empleadoId);
    if (req.body.cuentaId) await assertCuenta(empresaId, req.body.cuentaId);
    res.status(201).json(await prisma.nomina.create({ data: { ...req.body, empresaId } }));
  }));

contableRoutes.patch("/nominas/:id", requireAuth, requirePermiso("contable.nomina.editar"),
  validate({ params: idParams, body: updateNominaSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    if (req.body.empleadoId) await assertEmpleado(empresaId, req.body.empleadoId);
    const { count } = await prisma.nomina.updateMany({ where: { id: req.params.id, empresaId }, data: req.body });
    if (count === 0) throw new HttpError(404, "Nómina no encontrada");
    res.json(await prisma.nomina.findUnique({ where: { id: req.params.id } }));
  }));

// ===================== CAJA MENOR =====================
/** GET cajas con saldoActual DERIVADO por caja (= montoInicial - salidas +
 *  reposiciones). groupBy en lote por (cajaId, tipoMovimiento) para evitar N+1. */
contableRoutes.get("/cajas", requireAuth, requirePermiso("contable.cajamenor.ver"),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const cajas = await prisma.cajaMenor.findMany({ where: { empresaId }, orderBy: { createdAt: "desc" } });
    const movs = await prisma.cajaMenorMovimiento.groupBy({
      by: ["cajaId", "tipoMovimiento"], _sum: { valor: true }, where: { empresaId },
    });
    const delta = new Map<string, number>(); // cajaId -> (reposiciones - salidas)
    for (const m of movs) {
      const signo = m.tipoMovimiento === "REPOSICION" ? 1 : -1;
      delta.set(m.cajaId, (delta.get(m.cajaId) ?? 0) + signo * n(m._sum.valor));
    }
    res.json(cajas.map((c) => ({ ...c, saldoActual: n(c.montoInicial) + (delta.get(c.id) ?? 0) })));
  }));

contableRoutes.post("/cajas", requireAuth, requirePermiso("contable.cajamenor.crear"),
  validate({ body: createCajaSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    res.status(201).json(await prisma.cajaMenor.create({ data: { ...req.body, empresaId } }));
  }));

/** GET caja con saldo DERIVADO (= montoInicial - salidas + reposiciones) + movimientos. */
contableRoutes.get("/cajas/:id", requireAuth, requirePermiso("contable.cajamenor.ver"),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const caja = await prisma.cajaMenor.findFirst({ where: { id: req.params.id, empresaId } });
    if (!caja) throw new HttpError(404, "Caja menor no encontrada");
    const movimientos = await prisma.cajaMenorMovimiento.findMany({
      where: { cajaId: caja.id }, orderBy: { fechaMovimiento: "asc" },
    });
    const salidas = movimientos.filter((m) => m.tipoMovimiento === "SALIDA").reduce((s, m) => s + n(m.valor), 0);
    const reposiciones = movimientos.filter((m) => m.tipoMovimiento === "REPOSICION").reduce((s, m) => s + n(m.valor), 0);
    res.json({ ...caja, saldoActual: n(caja.montoInicial) - salidas + reposiciones, movimientos });
  }));

contableRoutes.post("/cajas/:id/movimientos", requireAuth, requirePermiso("contable.cajamenor.crear"),
  validate({ params: idParams, body: createMovimientoSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const caja = await prisma.cajaMenor.findFirst({ where: { id: req.params.id, empresaId }, select: { id: true, estado: true } });
    if (!caja) throw new HttpError(404, "Caja menor no encontrada");
    if (caja.estado === "CERRADA") throw new HttpError(400, "La caja menor está cerrada");
    let radicado: string | null = null;
    if (req.body.procesoId) radicado = await procesoRadicado(empresaId, req.body.procesoId);
    res.status(201).json(await prisma.cajaMenorMovimiento.create({
      data: { ...req.body, cajaId: caja.id, empresaId, radicado },
    }));
  }));

contableRoutes.patch("/cajas/:id", requireAuth, requirePermiso("contable.cajamenor.editar"),
  validate({ params: idParams, body: updateCajaSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { count } = await prisma.cajaMenor.updateMany({ where: { id: req.params.id, empresaId }, data: req.body });
    if (count === 0) throw new HttpError(404, "Caja menor no encontrada");
    res.json(await prisma.cajaMenor.findUnique({ where: { id: req.params.id } }));
  }));

// ===================== SERVICIOS FIJOS =====================
// `vencido` es DERIVADO en lectura (fechaVencimiento < ahora y no PAGADO), nunca
// guardado: un servicio pendiente cuya fecha ya pasó surge como vencido sin tocar
// el estadoPago. Ver spec contable-serviciosfijos.
contableRoutes.get("/servicios-fijos", requireAuth, requirePermiso("contable.serviciofijo.ver"),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { periodo } = req.query as Record<string, string | undefined>;
    const filas = await prisma.servicioFijo.findMany({
      where: { empresaId, ...(periodo ? { periodo } : {}) }, orderBy: { periodo: "desc" },
    });
    const ahora = new Date();
    res.json(filas.map((s) => ({
      ...s,
      vencido: s.estadoPago !== "PAGADO" && s.fechaVencimiento != null && s.fechaVencimiento < ahora,
    })));
  }));

contableRoutes.post("/servicios-fijos", requireAuth, requirePermiso("contable.serviciofijo.crear"),
  validate({ body: createServicioFijoSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    if (req.body.cuentaId) await assertCuenta(empresaId, req.body.cuentaId);
    try {
      res.status(201).json(await prisma.servicioFijo.create({ data: { ...req.body, empresaId } }));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
        throw new HttpError(409, "Ya existe ese servicio fijo para el proveedor y periodo");
      throw err;
    }
  }));

contableRoutes.patch("/servicios-fijos/:id", requireAuth, requirePermiso("contable.serviciofijo.editar"),
  validate({ params: idParams, body: updateServicioFijoSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { count } = await prisma.servicioFijo.updateMany({ where: { id: req.params.id, empresaId }, data: req.body });
    if (count === 0) throw new HttpError(404, "Servicio fijo no encontrado");
    res.json(await prisma.servicioFijo.findUnique({ where: { id: req.params.id } }));
  }));

// ===================== SERVICIOS FIJOS RECURRENTES (plantillas) =====================
// Calcula la fecha de vencimiento de un periodo 'YYYY-MM' para un día de pago,
// recortando al último día del mes (p. ej. día 31 en febrero → 28/29). UTC para
// no depender de la zona horaria del servidor.
function fechaVencimientoDe(periodo: string, diaPago: number): Date {
  const [y, m] = periodo.split("-").map(Number); // m: 1..12
  const ultimoDia = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1, Math.min(diaPago, ultimoDia)));
}

contableRoutes.get("/servicios-fijos-recurrentes", requireAuth, requirePermiso("contable.serviciofijo.ver"),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    res.json(await prisma.servicioFijoRecurrente.findMany({
      where: { empresaId }, orderBy: [{ activo: "desc" }, { proveedor: "asc" }],
    }));
  }));

contableRoutes.post("/servicios-fijos-recurrentes", requireAuth, requirePermiso("contable.serviciofijo.crear"),
  validate({ body: createServicioFijoRecurrenteSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    if (req.body.cuentaId) await assertCuenta(empresaId, req.body.cuentaId);
    try {
      res.status(201).json(await prisma.servicioFijoRecurrente.create({ data: { ...req.body, empresaId } }));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
        throw new HttpError(409, "Ya existe una plantilla para ese tipo de servicio y proveedor");
      throw err;
    }
  }));

contableRoutes.patch("/servicios-fijos-recurrentes/:id", requireAuth, requirePermiso("contable.serviciofijo.editar"),
  validate({ params: idParams, body: updateServicioFijoRecurrenteSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    if (req.body.cuentaId) await assertCuenta(empresaId, req.body.cuentaId);
    const { count } = await prisma.servicioFijoRecurrente.updateMany({ where: { id: req.params.id, empresaId }, data: req.body });
    if (count === 0) throw new HttpError(404, "Plantilla no encontrada");
    res.json(await prisma.servicioFijoRecurrente.findUnique({ where: { id: req.params.id } }));
  }));

// Genera/causa las instancias ServicioFijo de un periodo desde las plantillas
// activas. MENSUAL aplica a todo periodo; ANUAL solo si el mes del periodo ==
// mesPago. Idempotente: no duplica (respeta @@unique tipo+proveedor+periodo).
contableRoutes.post("/servicios-fijos-recurrentes/generar", requireAuth, requirePermiso("contable.serviciofijo.crear"),
  validate({ body: generarServiciosFijosSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { periodo } = req.body as { periodo: string };
    const mes = Number(periodo.split("-")[1]); // 1..12
    const plantillas = await prisma.servicioFijoRecurrente.findMany({ where: { empresaId, activo: true } });
    const aplican = plantillas.filter((p) => p.frecuencia === "MENSUAL" || p.mesPago === mes);
    const data = aplican.map((p) => ({
      empresaId, periodo, tipoServicio: p.tipoServicio, proveedor: p.proveedor,
      valorFacturado: p.valorEstimado, fechaVencimiento: fechaVencimientoDe(periodo, p.diaPago),
      estadoPago: "PENDIENTE" as const, cuentaId: p.cuentaId, recurrenteId: p.id,
    }));
    const { count } = data.length
      ? await prisma.servicioFijo.createMany({ data, skipDuplicates: true })
      : { count: 0 };
    res.json({ periodo, candidatas: aplican.length, generadas: count, omitidas: aplican.length - count });
  }));

// ===================== CUENTAS / BOLSAS =====================
contableRoutes.get("/cuentas", requireAuth, requirePermiso("contable.cuenta.ver"),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const cuentas = await prisma.cuentaBancaria.findMany({ where: { empresaId }, orderBy: { createdAt: "desc" } });
    // saldoActual derivado en lote (un groupBy por libro, evita N+1).
    const [ing, egr, sf, nom] = await Promise.all([
      prisma.ingreso.groupBy({ by: ["cuentaId"], _sum: { valorRecibido: true }, where: { empresaId, cuentaId: { not: null }, estadoPago: { in: ["PAGADO", "PARCIAL"] } } }),
      prisma.egreso.groupBy({ by: ["cuentaId"], _sum: { valorGasto: true }, where: { empresaId, cuentaId: { not: null }, estadoGasto: "PAGADO" } }),
      prisma.servicioFijo.groupBy({ by: ["cuentaId"], _sum: { valorFacturado: true }, where: { empresaId, cuentaId: { not: null }, estadoPago: "PAGADO" } }),
      prisma.nomina.groupBy({ by: ["cuentaId"], _sum: { valorNetoPagar: true }, where: { empresaId, cuentaId: { not: null }, estadoPago: "PAGADO" } }),
    ]);
    const sumBy = (rows: { cuentaId: string | null; _sum: Record<string, unknown> }[], field: string) =>
      new Map(rows.map((r) => [r.cuentaId, n(r._sum[field] as never)]));
    const mIng = sumBy(ing, "valorRecibido"), mEgr = sumBy(egr, "valorGasto"),
      mSf = sumBy(sf, "valorFacturado"), mNom = sumBy(nom, "valorNetoPagar");
    res.json(cuentas.map((c) => ({
      ...c,
      saldoActual: n(c.saldoInicial) + (mIng.get(c.id) ?? 0) - (mEgr.get(c.id) ?? 0) - (mSf.get(c.id) ?? 0) - (mNom.get(c.id) ?? 0),
    })));
  }));

contableRoutes.post("/cuentas", requireAuth, requirePermiso("contable.cuenta.crear"),
  validate({ body: createCuentaSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    res.status(201).json(await prisma.cuentaBancaria.create({ data: { ...req.body, empresaId } }));
  }));

/** GET cuenta con saldoActual DERIVADO (saldoInicial + ingresos PAGADO - todos los
 *  egresos PAGADO que salen de la bolsa: egresos + servicios fijos + nómina). */
contableRoutes.get("/cuentas/:id", requireAuth, requirePermiso("contable.cuenta.ver"),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const cuenta = await prisma.cuentaBancaria.findFirst({ where: { id: req.params.id, empresaId } });
    if (!cuenta) throw new HttpError(404, "Cuenta no encontrada");
    const [ing, egr, sf, nom] = await Promise.all([
      prisma.ingreso.aggregate({ _sum: { valorRecibido: true }, where: { empresaId, cuentaId: cuenta.id, estadoPago: { in: ["PAGADO", "PARCIAL"] } } }),
      prisma.egreso.aggregate({ _sum: { valorGasto: true }, where: { empresaId, cuentaId: cuenta.id, estadoGasto: "PAGADO" } }),
      prisma.servicioFijo.aggregate({ _sum: { valorFacturado: true }, where: { empresaId, cuentaId: cuenta.id, estadoPago: "PAGADO" } }),
      prisma.nomina.aggregate({ _sum: { valorNetoPagar: true }, where: { empresaId, cuentaId: cuenta.id, estadoPago: "PAGADO" } }),
    ]);
    const saldoActual = n(cuenta.saldoInicial) + n(ing._sum.valorRecibido)
      - n(egr._sum.valorGasto) - n(sf._sum.valorFacturado) - n(nom._sum.valorNetoPagar);
    res.json({ ...cuenta, saldoActual });
  }));

contableRoutes.patch("/cuentas/:id", requireAuth, requirePermiso("contable.cuenta.editar"),
  validate({ params: idParams, body: updateCuentaSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { count } = await prisma.cuentaBancaria.updateMany({ where: { id: req.params.id, empresaId }, data: req.body });
    if (count === 0) throw new HttpError(404, "Cuenta no encontrada");
    res.json(await prisma.cuentaBancaria.findUnique({ where: { id: req.params.id } }));
  }));

// Borrar bolsa. `cuentaId` es escalar SIN FK (la BD no lo bloquea), así que la
// app aplica el Restrict: no se borra si la referencia algún movimiento. La baja
// blanda es estadoCuenta = INACTIVA. Ver spec contable-cuentas.
contableRoutes.delete("/cuentas/:id", requireAuth, requirePermiso("contable.cuenta.editar"),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const cuenta = await prisma.cuentaBancaria.findFirst({ where: { id: req.params.id, empresaId }, select: { id: true } });
    if (!cuenta) throw new HttpError(404, "Cuenta no encontrada");
    const [ing, egr, nom, sf, rec] = await Promise.all([
      prisma.ingreso.count({ where: { empresaId, cuentaId: cuenta.id } }),
      prisma.egreso.count({ where: { empresaId, cuentaId: cuenta.id } }),
      prisma.nomina.count({ where: { empresaId, cuentaId: cuenta.id } }),
      prisma.servicioFijo.count({ where: { empresaId, cuentaId: cuenta.id } }),
      prisma.servicioFijoRecurrente.count({ where: { empresaId, cuentaId: cuenta.id } }),
    ]);
    if (ing + egr + nom + sf + rec > 0)
      throw new HttpError(409, "No se puede borrar: la cuenta tiene movimientos asociados. Desactívala (estado INACTIVA) en su lugar.");
    await prisma.cuentaBancaria.delete({ where: { id: cuenta.id } });
    res.status(204).end();
  }));

// ===================== CARTERA =====================
/** Total acordado SNAPSHOT desde el plan de cobro del comercial, según modalidad. */
function totalDesdePlan(config: any, contrato: any): number | null {
  if (config) {
    switch (config.modalidadCobro) {
      case "FIJO": return config.valorFijo != null ? n(config.valorFijo) : null;
      case "CUOTALITIS":
      case "CUOTA_MIXTA": {
        const t = (config.numeroCuotas ?? 0) * n(config.valorCuota) + n(config.valorFijo);
        return t > 0 ? t : null;
      }
      case "PRIMA_EXITO": return null; // monto incierto hasta el éxito
      default: return config.valorFijo != null ? n(config.valorFijo) : null;
    }
  }
  return contrato.valorAcordado != null ? n(contrato.valorAcordado) : null;
}

contableRoutes.get("/cartera", requireAuth, requirePermiso("contable.cartera.ver"),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { clienteId } = req.query as Record<string, string | undefined>;
    const filas = await prisma.cartera.findMany({
      where: { empresaId, ...(clienteId ? { clienteId } : {}) }, orderBy: { createdAt: "desc" },
    });
    res.json(await Promise.all(filas.map(conSaldo)));
  }));

/** Abre una cartera para un contrato firmado (snapshot del total del plan). */
contableRoutes.post("/cartera", requireAuth, requirePermiso("contable.cartera.ver"),
  validate({ body: createCarteraSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const contrato = await prisma.contratoComercial.findFirst({
      where: { id: req.body.contratoId, empresaId },
      select: { id: true, clienteId: true, tipoCobroAcordado: true, valorAcordado: true },
    });
    if (!contrato) throw new HttpError(400, "El contrato no pertenece a tu empresa");
    const config = await prisma.configuracionCobro.findUnique({ where: { contratoId: contrato.id } });
    try {
      const cartera = await prisma.cartera.create({
        data: {
          empresaId, clienteId: contrato.clienteId, procesoId: req.body.procesoId,
          contratoId: contrato.id, configuracionCobroId: config?.id,
          valorTotalAcordado: totalDesdePlan(config, contrato),
          tipoCobro: config?.modalidadCobro ?? contrato.tipoCobroAcordado,
          fechaProximoPago: config?.fechaPrimerPago,
          responsableId: req.body.responsableId, observaciones: req.body.observaciones,
        },
      });
      res.status(201).json(await conSaldo(cartera));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
        throw new HttpError(409, "Ya existe una cartera para ese contrato");
      throw err;
    }
  }));

/** Re-sincroniza el total acordado desde el plan de cobro actual. */
contableRoutes.post("/cartera/:id/resync", requireAuth, requirePermiso("contable.cartera.resync"),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const cartera = await prisma.cartera.findFirst({ where: { id: req.params.id, empresaId } });
    if (!cartera) throw new HttpError(404, "Cartera no encontrada");
    const config = cartera.configuracionCobroId
      ? await prisma.configuracionCobro.findUnique({ where: { id: cartera.configuracionCobroId } })
      : null;
    const contrato = cartera.contratoId
      ? await prisma.contratoComercial.findUnique({ where: { id: cartera.contratoId }, select: { valorAcordado: true, tipoCobroAcordado: true } })
      : null;
    const actualizada = await prisma.cartera.update({
      where: { id: cartera.id },
      data: {
        valorTotalAcordado: totalDesdePlan(config, contrato ?? {}),
        tipoCobro: config?.modalidadCobro ?? cartera.tipoCobro,
        fechaProximoPago: config?.fechaPrimerPago ?? cartera.fechaProximoPago,
      },
    });
    res.json(await conSaldo(actualizada));
  }));

// ===================== REPORTES (derivado, mensual) =====================
contableRoutes.get("/reportes", requireAuth, requirePermiso("contable.reporte.ver"),
  validate({ query: reporteQuery }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const periodo = String(req.query.periodo); // 'YYYY-MM'
    const inicio = new Date(`${periodo}-01T00:00:00`);
    const fin = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 1);
    const rango = { gte: inicio, lt: fin };

    const [ingresos, egresos, nomina, servicios, cajaSal] = await Promise.all([
      prisma.ingreso.aggregate({ _sum: { valorRecibido: true }, where: { empresaId, fechaIngreso: rango, estadoPago: { in: ["PAGADO", "PARCIAL"] } } }),
      prisma.egreso.aggregate({ _sum: { valorGasto: true }, where: { empresaId, fechaGasto: rango, estadoGasto: "PAGADO" } }),
      prisma.nomina.aggregate({ _sum: { valorNetoPagar: true }, where: { empresaId, periodo, estadoPago: "PAGADO" } }),
      prisma.servicioFijo.aggregate({ _sum: { valorFacturado: true }, where: { empresaId, periodo, estadoPago: "PAGADO" } }),
      prisma.cajaMenorMovimiento.aggregate({ _sum: { valor: true }, where: { empresaId, tipoMovimiento: "SALIDA", fechaMovimiento: rango } }),
    ]);
    const totalIngresos = n(ingresos._sum.valorRecibido);
    const totalEgresos = n(egresos._sum.valorGasto) + n(nomina._sum.valorNetoPagar) + n(servicios._sum.valorFacturado) + n(cajaSal._sum.valor);
    res.json({
      periodo,
      totalIngresos,
      totalEgresos,
      utilidadNeta: totalIngresos - totalEgresos,
      desglose: {
        egresosGenerales: n(egresos._sum.valorGasto),
        nomina: n(nomina._sum.valorNetoPagar),
        serviciosFijos: n(servicios._sum.valorFacturado),
        cajaMenor: n(cajaSal._sum.valor),
      },
    });
  }));
