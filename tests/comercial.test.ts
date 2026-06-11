import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/index", () => {
  const prisma: any = {
    usuario: { findUnique: vi.fn(), findFirst: vi.fn() },
    cliente: { findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    solicitudAsignacionProceso: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    usuarioRolEmpresa: { findFirst: vi.fn() },
    proceso: { create: vi.fn(), count: vi.fn() },
    parteProceso: { create: vi.fn() },
    seguimientoComercial: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    comisionDespacho: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    cartera: { findMany: vi.fn() },
    ingreso: { aggregate: vi.fn() },
    faseComercialHistorial: { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    cotizacion: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    contratoComercial: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    configuracionCobro: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    tipoProceso: { findUnique: vi.fn() },
    litigante: { upsert: vi.fn(), create: vi.fn() },
    permiso: { findUnique: vi.fn() },
    modulo: { findMany: vi.fn() },
    suscripcion: { findUnique: vi.fn() },
    $transaction: vi.fn((cb: any) => cb(prisma)),
  };
  return { prisma };
});

import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";

const app = createApp();
const p = prisma as any;
const token = signToken({ sub: "cli1", rol: "USUARIO" });
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const cuenta = { activo: true, activationToken: null, tokenVersion: 0, empresaId: "eA", esAdminEmpresa: true, rolesEmpresa: [] };

function comercialContratado(si: boolean) {
  p.suscripcion.findUnique.mockResolvedValue({
    estado: "ACTIVA",
    plan: { modulos: si ? [{ modulo: { clave: "comercial" } }] : [], cuotas: [] },
    modulos: [], cuotas: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  p.usuario.findUnique.mockResolvedValue(cuenta);
  p.permiso.findUnique.mockResolvedValue({ modulo: { clave: "comercial" }, roles: [{ rolEmpresa: "COMERCIAL" }] });
  p.modulo.findMany.mockResolvedValue([]);
  comercialContratado(true);
});

describe("autorización", () => {
  it("401 sin token", async () => {
    expect((await request(app).get("/comercial/seguimientos")).status).toBe(401);
  });
  it("403 si el módulo comercial no está contratado", async () => {
    comercialContratado(false);
    // La agenda/seguimientos ya NO exige el módulo (es baseline) → se prueba con /alertas.
    const res = await request(app).get("/comercial/alertas").set(auth(token));
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("Módulo no contratado");
  });
  it("agenda/seguimientos es baseline: accesible para cualquier usuario del despacho (sin módulo ni rol)", async () => {
    p.usuario.findUnique.mockResolvedValue({ ...cuenta, esAdminEmpresa: false, rolesEmpresa: [] });
    comercialContratado(false);
    p.seguimientoComercial.findMany.mockResolvedValue([]);
    const res = await request(app).get("/comercial/seguimientos").set(auth(token));
    expect(res.status).toBe(200);
  });
});

describe("seguimientos", () => {
  it("201 crea forzando empresaId + registradoPorId del token", async () => {
    p.cliente.findFirst.mockResolvedValue({ id: "c1" });
    p.seguimientoComercial.create.mockResolvedValue({ id: "s1" });
    const res = await request(app).post("/comercial/seguimientos").set(auth(token))
      .send({ clienteId: "c1", tipoGestion: "LLAMADA" });
    expect(res.status).toBe(201);
    expect(p.seguimientoComercial.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ empresaId: "eA", registradoPorId: "cli1" }) }),
    );
  });
  it("400 si el cliente es de otra empresa", async () => {
    p.cliente.findFirst.mockResolvedValue(null);
    const res = await request(app).post("/comercial/seguimientos").set(auth(token))
      .send({ clienteId: "ajeno", tipoGestion: "LLAMADA" });
    expect(res.status).toBe(400);
    expect(p.seguimientoComercial.create).not.toHaveBeenCalled();
  });
});

describe("fases", () => {
  it("400 al marcar PERDIDO sin motivo", async () => {
    p.cliente.findFirst.mockResolvedValue({ id: "c1", empresaId: "eA" });
    const res = await request(app).post("/comercial/clientes/c1/fase").set(auth(token))
      .send({ fase: "PERDIDO" });
    expect(res.status).toBe(400);
  });

  it("FIRMADO convierte el cliente a CLIENTE (acoplamiento + Litigante)", async () => {
    p.cliente.findFirst.mockResolvedValue({
      id: "c1", empresaId: "eA", litiganteId: null, nombre: "Juan",
      tipoPersona: "NATURAL", tipoDocumento: "CC", numeroDocumento: "123",
      email: null, telefono: null, responsableComercialId: null,
    });
    p.faseComercialHistorial.updateMany.mockResolvedValue({ count: 1 });
    p.faseComercialHistorial.create.mockResolvedValue({ id: "f1", fase: "FIRMADO" });
    p.litigante.upsert.mockResolvedValue({ id: "l1" });
    p.cliente.update.mockResolvedValue({ id: "c1", estado: "CLIENTE" });

    const res = await request(app).post("/comercial/clientes/c1/fase").set(auth(token))
      .send({ fase: "FIRMADO" });
    expect(res.status).toBe(201);
    expect(p.faseComercialHistorial.updateMany).toHaveBeenCalled(); // cierra la fase abierta
    expect(p.litigante.upsert).toHaveBeenCalled();
    expect(p.cliente.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: "CLIENTE", litiganteId: "l1" }) }),
    );
  });

  it("PERDIDO marca el cliente DESCARTADO", async () => {
    p.cliente.findFirst.mockResolvedValue({ id: "c1", empresaId: "eA", responsableComercialId: null });
    p.faseComercialHistorial.updateMany.mockResolvedValue({ count: 0 });
    p.faseComercialHistorial.create.mockResolvedValue({ id: "f1", fase: "PERDIDO" });
    p.cliente.update.mockResolvedValue({ id: "c1", estado: "DESCARTADO" });
    const res = await request(app).post("/comercial/clientes/c1/fase").set(auth(token))
      .send({ fase: "PERDIDO", motivoPerdida: "Sin presupuesto" });
    expect(res.status).toBe(201);
    expect(p.cliente.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { estado: "DESCARTADO" } }),
    );
  });
});

describe("cotización + contrato + cobro", () => {
  it("201 crea cotización", async () => {
    p.cliente.findFirst.mockResolvedValue({ id: "c1" });
    p.cotizacion.create.mockResolvedValue({ id: "q1" });
    const res = await request(app).post("/comercial/cotizaciones").set(auth(token))
      .send({ clienteId: "c1", tipoServicio: "Tutela", valorCotizado: 5000000, formaPago: "CONTADO" });
    expect(res.status).toBe(201);
    expect(p.cotizacion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ empresaId: "eA", creadoPorId: "cli1" }) }),
    );
  });

  it("201 crea contrato", async () => {
    p.cliente.findFirst.mockResolvedValue({ id: "c1" });
    p.contratoComercial.create.mockResolvedValue({ id: "k1" });
    const res = await request(app).post("/comercial/contratos").set(auth(token))
      .send({ clienteId: "c1", tipoContrato: "PRESTACION_SERVICIOS", tipoCobroAcordado: "FIJO", valorAcordado: 3000000 });
    expect(res.status).toBe(201);
  });

  it("PUT cobro hace upsert de la configuración 1:1", async () => {
    p.contratoComercial.findFirst.mockResolvedValue({ id: "k1", clienteId: "c1" });
    p.configuracionCobro.upsert.mockResolvedValue({ id: "cfg1" });
    const res = await request(app).put("/comercial/contratos/k1/cobro").set(auth(token))
      .send({ modalidadCobro: "FIJO", valorFijo: 3000000 });
    expect(res.status).toBe(200);
    expect(p.configuracionCobro.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contratoId: "k1" } }),
    );
  });
});

describe("alertas", () => {
  it("200 devuelve los 7 buckets derivados", async () => {
    p.cliente.findMany.mockResolvedValue([]);
    p.cotizacion.findMany.mockResolvedValue([]);
    p.contratoComercial.findMany.mockResolvedValue([]);
    p.configuracionCobro.findMany.mockResolvedValue([]);
    p.seguimientoComercial.findMany.mockResolvedValue([]);
    const res = await request(app).get("/comercial/alertas").set(auth(token));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      "citaHoy", "contratoSinFirmar", "cuotaInicialVencida", "poderPendiente",
      "propuestaSinRespuesta", "prospectoSinSeguimiento", "tareaVencida",
    ]);
  });
});

describe("pipeline (señales derivadas)", () => {
  it("deriva diasSinGestion / faseActual / diasEnFase / ultimaDisposicion / tareaVencida", async () => {
    const hace = (d: number) => new Date(Date.now() - d * 86_400_000);
    p.cliente.findMany.mockResolvedValue([
      {
        id: "c1", nombre: "Ana", telefono: "300", estado: "PROSPECTO", viabilidad: null, canalIngreso: null, responsableComercialId: "u1",
        seguimientos: [{ fechaContacto: hace(10), disposicion: "INTERESADO", completada: false, canceladaEn: null, fechaProximaTarea: hace(1), proximaTarea: "Llamar" }],
        fasesComerciales: [{ fase: "NEGOCIACION", fechaInicioFase: hace(5) }],
      },
    ]);
    const res = await request(app).get("/comercial/pipeline").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ diasSinGestion: 10, faseActual: "NEGOCIACION", diasEnFase: 5, ultimaDisposicion: "INTERESADO", tareaVencida: true });
  });
});

describe("hoy (cockpit)", () => {
  it("agrupa vencidas y fríos", async () => {
    const ayer = new Date(Date.now() - 86_400_000);
    p.seguimientoComercial.findMany.mockResolvedValue([
      { id: "s1", clienteId: "c1", titulo: null, tipoGestion: "LLAMADA", proximaTarea: "x", fechaProximaTarea: ayer, cliente: { nombre: "Ana", telefono: "300" } },
    ]);
    p.cliente.findMany.mockResolvedValue([{ id: "c2", nombre: "Frío", telefono: null }]);
    const res = await request(app).get("/comercial/hoy").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.vencidas.map((x: { clienteId: string }) => x.clienteId)).toEqual(["c1"]);
    expect(res.body.frios.map((x: { clienteId: string }) => x.clienteId)).toEqual(["c2"]);
  });
});

describe("registrar gestión con disposición", () => {
  it("persiste la disposicion", async () => {
    p.cliente.findFirst.mockResolvedValue({ id: "c1" });
    p.seguimientoComercial.create.mockResolvedValue({ id: "s1", disposicion: "INTERESADO" });
    const res = await request(app).post("/comercial/seguimientos").set(auth(token)).send({ clienteId: "c1", tipoGestion: "LLAMADA", disposicion: "INTERESADO" });
    expect(res.status).toBe(201);
    expect(p.seguimientoComercial.create.mock.calls[0][0].data).toMatchObject({ disposicion: "INTERESADO" });
  });
});

describe("puente: solicitud de asignación", () => {
  it("201 crea solicitud (contrato FIRMADO) con tipo default de la necesidad del cliente", async () => {
    p.cliente.findFirst.mockResolvedValue({ id: "c1", necesidadTipoProcesoId: "tp1", resumenCaso: "Caso X" });
    p.contratoComercial.findFirst.mockResolvedValue({
      id: "k1", estadoContrato: "FIRMADO", estadoPoder: "FIRMADO",
      tipoCobroAcordado: "FIJO", valorAcordado: null, porcentajeAcordado: null,
    });
    p.configuracionCobro.findUnique.mockResolvedValue(null);
    p.solicitudAsignacionProceso.create.mockResolvedValue({ id: "sol1", estado: "PENDIENTE" });
    const res = await request(app).post("/comercial/solicitudes").set(auth(token))
      .send({ clienteId: "c1", contratoId: "k1" });
    expect(res.status).toBe(201);
    expect(p.solicitudAsignacionProceso.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tipoProcesoId: "tp1", empresaId: "eA", solicitadoPorId: "cli1" }) }),
    );
  });

  it("400 si el contrato/poder no están firmados", async () => {
    p.cliente.findFirst.mockResolvedValue({ id: "c1", necesidadTipoProcesoId: "tp1", resumenCaso: null });
    p.contratoComercial.findFirst.mockResolvedValue({ id: "k1", estadoContrato: "ENVIADO", estadoPoder: "PENDIENTE" });
    const res = await request(app).post("/comercial/solicitudes").set(auth(token))
      .send({ clienteId: "c1", contratoId: "k1" });
    expect(res.status).toBe(400);
    expect(p.solicitudAsignacionProceso.create).not.toHaveBeenCalled();
  });

  it("asignar materializa Proceso + ParteProceso y deja la solicitud ASIGNADA", async () => {
    p.solicitudAsignacionProceso.findFirst.mockResolvedValue({
      id: "sol1", estado: "PENDIENTE", clienteId: "c1", contratoId: "k1",
      tipoProcesoId: "tp1", prioridad: "MEDIA", rolParteSugerido: null, tituloPropuesto: null, tareasDefinidas: null,
    });
    p.usuarioRolEmpresa.findFirst.mockResolvedValue({ id: "ur1" }); // abogado JURIDICO
    p.tipoProceso.findUnique.mockResolvedValue({
      id: "tp1", empresaId: null, esquemaVersion: 1, jurisdiccion: "ORDINARIA_CIVIL",
      etapas: [{ key: "inicio", nombre: "Inicio", orden: 1 }],
    });
    p.cliente.findUniqueOrThrow.mockResolvedValue({
      id: "c1", empresaId: "eA", litiganteId: null, nombre: "Juan",
      tipoPersona: "NATURAL", tipoDocumento: "CC", numeroDocumento: "123", email: null, telefono: null,
    });
    p.litigante.upsert.mockResolvedValue({ id: "l1" });
    p.proceso.count.mockResolvedValue(0); // generarCodigoInterno → COM-AAAA-0001
    p.proceso.create.mockResolvedValue({ id: "pr1", codigoInterno: "COM-2026-0001" });
    p.parteProceso.create.mockResolvedValue({ id: "pp1" });
    p.cliente.update.mockResolvedValue({});
    p.solicitudAsignacionProceso.update.mockResolvedValue({ id: "sol1", estado: "ASIGNADA", procesoId: "pr1" });

    const res = await request(app).post("/comercial/solicitudes/sol1/asignar").set(auth(token))
      .send({ abogadoAsignadoId: "abg1" });
    expect(res.status).toBe(201);
    expect(p.proceso.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({
        responsableId: "abg1", etapaActual: "inicio", jurisdiccion: "ORDINARIA_CIVIL", estado: "ABIERTO",
      }) }),
    );
    expect(p.parteProceso.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rol: "DEMANDANTE", esNuestroCliente: true }) }),
    );
    expect(p.solicitudAsignacionProceso.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: "ASIGNADA", procesoId: "pr1" }) }),
    );
  });

  it("400 si el abogado no tiene rol JURIDICO", async () => {
    p.solicitudAsignacionProceso.findFirst.mockResolvedValue({ id: "sol1", estado: "PENDIENTE", clienteId: "c1", tipoProcesoId: "tp1" });
    p.usuarioRolEmpresa.findFirst.mockResolvedValue(null);
    const res = await request(app).post("/comercial/solicitudes/sol1/asignar").set(auth(token))
      .send({ abogadoAsignadoId: "noabg" });
    expect(res.status).toBe(400);
    expect(p.proceso.create).not.toHaveBeenCalled();
  });

  it("409 si la solicitud ya fue resuelta", async () => {
    p.solicitudAsignacionProceso.findFirst.mockResolvedValue({ id: "sol1", estado: "ASIGNADA" });
    const res = await request(app).post("/comercial/solicitudes/sol1/asignar").set(auth(token))
      .send({ abogadoAsignadoId: "abg1" });
    expect(res.status).toBe(409);
  });

  it("rechazar marca RECHAZADA con motivo", async () => {
    p.solicitudAsignacionProceso.updateMany.mockResolvedValue({ count: 1 });
    p.solicitudAsignacionProceso.findUnique.mockResolvedValue({ id: "sol1", estado: "RECHAZADA" });
    const res = await request(app).post("/comercial/solicitudes/sol1/rechazar").set(auth(token))
      .send({ motivoRechazo: "Documentos incompletos" });
    expect(res.status).toBe(200);
    expect(p.solicitudAsignacionProceso.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: "RECHAZADA" }) }),
    );
  });
});

// El cuenta por defecto es admin de empresa; para los casos "solo comercial"
// se re-mockea usuario.findUnique con un COMERCIAL no-admin.
const comercialNoAdmin = { ...cuenta, esAdminEmpresa: false, rolesEmpresa: [{ rolEmpresa: "COMERCIAL" }] };

describe("comisiones internas del despacho", () => {
  it("GET acota al propio comercial cuando NO es admin de empresa", async () => {
    p.usuario.findUnique.mockResolvedValue(comercialNoAdmin);
    p.comisionDespacho.findMany.mockResolvedValue([]);
    const res = await request(app).get("/comercial/comisiones").set(auth(token));
    expect(res.status).toBe(200);
    expect(p.comisionDespacho.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ empresaId: "eA", comercialId: "cli1" }) }),
    );
  });

  it("GET admin ve todas (sin filtro por comercialId)", async () => {
    p.comisionDespacho.findMany.mockResolvedValue([]);
    const res = await request(app).get("/comercial/comisiones").set(auth(token));
    expect(res.status).toBe(200);
    expect(p.comisionDespacho.findMany.mock.calls[0][0].where.comercialId).toBeUndefined();
  });

  it("403 si un COMERCIAL no-admin intenta crear", async () => {
    p.usuario.findUnique.mockResolvedValue(comercialNoAdmin);
    p.permiso.findUnique.mockResolvedValue({ modulo: { clave: "comercial" }, roles: [{ rolEmpresa: "ADMINISTRADOR" }] });
    const res = await request(app).post("/comercial/comisiones").set(auth(token))
      .send({ clienteId: "c1", comercialId: "cli1", baseCalculo: 1000000, monto: 100000 });
    expect(res.status).toBe(403);
    expect(p.comisionDespacho.create).not.toHaveBeenCalled();
  });

  it("201 admin crea (fuerza empresaId + registradoPorId)", async () => {
    p.cliente.findFirst.mockResolvedValue({ id: "c1" });
    p.usuario.findFirst.mockResolvedValue({ id: "cli1" });
    p.comisionDespacho.create.mockResolvedValue({ id: "cm1" });
    const res = await request(app).post("/comercial/comisiones").set(auth(token))
      .send({ clienteId: "c1", comercialId: "cli1", baseCalculo: 1000000, monto: 100000 });
    expect(res.status).toBe(201);
    expect(p.comisionDespacho.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ empresaId: "eA", registradoPorId: "cli1" }) }),
    );
  });
});

describe("cartera (resumen de cobro en la ficha)", () => {
  it("200 devuelve saldo derivado (total - pagado)", async () => {
    p.cliente.findFirst.mockResolvedValue({ id: "c1" });
    p.cartera.findMany.mockResolvedValue([
      { id: "k1", valorTotalAcordado: 1000000, configuracionCobroId: "cc1", clienteId: "c1", procesoId: null, empresaId: "eA" },
    ]);
    p.ingreso.aggregate.mockResolvedValue({ _sum: { valorRecibido: 400000 } });
    const res = await request(app).get("/comercial/clientes/c1/cartera").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ valorPagado: 400000, saldoPendiente: 600000 });
  });
});

describe("agenda comercial", () => {
  it("200 acota al comercial propio (no admin)", async () => {
    p.usuario.findUnique.mockResolvedValue(comercialNoAdmin);
    p.seguimientoComercial.findMany.mockResolvedValue([]);
    const res = await request(app).get("/comercial/agenda?desde=2026-06-01&hasta=2026-06-30").set(auth(token));
    expect(res.status).toBe(200);
    expect(p.seguimientoComercial.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ comercialId: "cli1" }) }),
    );
  });

  it("completar marca completada + resultado", async () => {
    p.seguimientoComercial.updateMany.mockResolvedValue({ count: 1 });
    p.seguimientoComercial.findUnique.mockResolvedValue({ id: "s1", completada: true });
    const res = await request(app).post("/comercial/seguimientos/s1/completar").set(auth(token))
      .send({ resultado: "Habló con el cliente" });
    expect(res.status).toBe(200);
    expect(p.seguimientoComercial.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completada: true, resultado: "Habló con el cliente" }) }),
    );
  });

  it("404 al cancelar un seguimiento inexistente", async () => {
    p.seguimientoComercial.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app).post("/comercial/seguimientos/nope/cancelar").set(auth(token))
      .send({ motivo: "ya no aplica" });
    expect(res.status).toBe(404);
  });
});
