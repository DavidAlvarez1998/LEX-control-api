import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/index", () => {
  const prisma: any = {
    usuario: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    prospecto: { findFirst: vi.fn(), groupBy: vi.fn(), updateMany: vi.fn() },
    seguimientoProspecto: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), groupBy: vi.fn() },
  };
  return { prisma };
});

import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";

const app = createApp();
const p = prisma as any;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const adminTok = signToken({ sub: "adm1", rol: "ADMIN" });
const comTok = signToken({ sub: "com1", rol: "COMERCIAL" });

const cuentaPlataforma = {
  activo: true, activationToken: null, tokenVersion: 0, empresaId: null,
  esAdminEmpresa: false, empresa: null, rolesEmpresa: [], porcentajeComision: 10,
};

beforeEach(() => {
  vi.clearAllMocks();
  p.usuario.findUnique.mockResolvedValue(cuentaPlataforma); // requireAuth
});

describe("seguimiento — crear sobre un prospecto", () => {
  beforeEach(() => {
    p.prospecto.findFirst.mockResolvedValue({ id: "pr1", comercialId: "com1" });
    p.seguimientoProspecto.create.mockImplementation((a: any) => Promise.resolve({ id: "sg1", ...a.data }));
  });

  it("sin fechaProgramada => se registra como hecha (completada, fechaCompletada)", async () => {
    const res = await request(app).post("/prospectos/pr1/seguimientos").set(auth(comTok))
      .send({ tipo: "LLAMADA", nota: "Interesado", resultado: "Pide cotización" });
    expect(res.status).toBe(201);
    const data = p.seguimientoProspecto.create.mock.calls[0][0].data;
    expect(data.completada).toBe(true);
    expect(data.fechaCompletada).toBeInstanceOf(Date);
    expect(data.fechaProgramada).toBeUndefined();
  });

  it("con fechaProgramada => queda pendiente (agenda)", async () => {
    const res = await request(app).post("/prospectos/pr1/seguimientos").set(auth(comTok))
      .send({ tipo: "LLAMADA", titulo: "Insistir oferta", fechaProgramada: "2026-06-11T15:00:00.000Z" });
    expect(res.status).toBe(201);
    const data = p.seguimientoProspecto.create.mock.calls[0][0].data;
    expect(data.completada).toBe(false);
    expect(data.fechaCompletada).toBeNull();
    expect(data.fechaProgramada).toBeInstanceOf(Date);
  });

  it("ADMIN: el dueño por defecto sale del comercial del prospecto", async () => {
    p.prospecto.findFirst.mockResolvedValue({ id: "pr1", comercialId: "comB" });
    await request(app).post("/prospectos/pr1/seguimientos").set(auth(adminTok)).send({ tipo: "CORREO", nota: "x" });
    expect(p.seguimientoProspecto.create.mock.calls[0][0].data.comercialId).toBe("comB");
  });

  it("COMERCIAL: el dueño siempre es sí mismo", async () => {
    await request(app).post("/prospectos/pr1/seguimientos").set(auth(comTok)).send({ tipo: "WHATSAPP", nota: "x" });
    expect(p.seguimientoProspecto.create.mock.calls[0][0].data.comercialId).toBe("com1");
  });

  it("404 si el prospecto no es del comercial", async () => {
    p.prospecto.findFirst.mockResolvedValue(null);
    const res = await request(app).post("/prospectos/prX/seguimientos").set(auth(comTok)).send({ nota: "x" });
    expect(res.status).toBe(404);
  });
});

describe("seguimiento — timeline", () => {
  it("lista las actividades del prospecto (desc)", async () => {
    p.prospecto.findFirst.mockResolvedValue({ id: "pr1", comercialId: "com1" });
    p.seguimientoProspecto.findMany.mockResolvedValue([]);
    await request(app).get("/prospectos/pr1/seguimientos").set(auth(comTok));
    expect(p.seguimientoProspecto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { prospectoId: "pr1" }, orderBy: { createdAt: "desc" } }),
    );
  });
});

describe("seguimiento — editar / completar / borrar (scope vía prospecto padre)", () => {
  beforeEach(() => {
    p.seguimientoProspecto.findUnique.mockResolvedValue({ id: "sg1", prospectoId: "pr1", comercialId: "com1" });
    p.prospecto.findFirst.mockResolvedValue({ id: "pr1" });
  });

  it("completar marca completada + fechaCompletada + resultado y avanza NUEVO→CONTACTADO", async () => {
    p.seguimientoProspecto.update.mockResolvedValue({ id: "sg1", completada: true });
    p.prospecto.updateMany.mockResolvedValue({ count: 1 });
    const res = await request(app).post("/seguimientos/sg1/completar").set(auth(comTok)).send({ resultado: "Cerró, agenda demo" });
    expect(res.status).toBe(200);
    const data = p.seguimientoProspecto.update.mock.calls[0][0].data;
    expect(data.completada).toBe(true);
    expect(data.fechaCompletada).toBeInstanceOf(Date);
    expect(data.resultado).toBe("Cerró, agenda demo");
    // avance de etapa: solo si sigue en NUEVO
    const adv = p.prospecto.updateMany.mock.calls[0][0];
    expect(adv.where).toMatchObject({ estado: "NUEVO" });
    expect(adv.data).toMatchObject({ estado: "CONTACTADO" });
  });

  it("reprogramar via PATCH cambia fechaProgramada", async () => {
    p.seguimientoProspecto.update.mockResolvedValue({ id: "sg1" });
    await request(app).patch("/seguimientos/sg1").set(auth(comTok)).send({ fechaProgramada: "2026-06-15T09:00:00.000Z" });
    expect(p.seguimientoProspecto.update.mock.calls[0][0].data.fechaProgramada).toBeInstanceOf(Date);
  });

  it("COMERCIAL no puede mover el dueño (comercialId se ignora)", async () => {
    p.seguimientoProspecto.update.mockResolvedValue({ id: "sg1" });
    await request(app).patch("/seguimientos/sg1").set(auth(comTok)).send({ comercialId: "otro", titulo: "nuevo" });
    const data = p.seguimientoProspecto.update.mock.calls[0][0].data;
    expect(data.comercialId).toBeUndefined();
    expect(data.titulo).toBe("nuevo");
  });

  it("cancelar marca canceladaEn + motivo (no completada)", async () => {
    p.seguimientoProspecto.update.mockResolvedValue({ id: "sg1" });
    const res = await request(app).post("/seguimientos/sg1/cancelar").set(auth(comTok)).send({ motivo: "Cliente no interesado" });
    expect(res.status).toBe(200);
    const data = p.seguimientoProspecto.update.mock.calls[0][0].data;
    expect(data.canceladaEn).toBeInstanceOf(Date);
    expect(data.motivoCancelacion).toBe("Cliente no interesado");
    expect(data.completada).toBe(false);
  });

  it("cancelar sin motivo -> 400", async () => {
    const res = await request(app).post("/seguimientos/sg1/cancelar").set(auth(comTok)).send({});
    expect(res.status).toBe(400);
  });

  it("reabrir vuelve a pendiente (limpia completada y cancelación)", async () => {
    p.seguimientoProspecto.update.mockResolvedValue({ id: "sg1" });
    const res = await request(app).post("/seguimientos/sg1/reabrir").set(auth(comTok)).send({});
    expect(res.status).toBe(200);
    const data = p.seguimientoProspecto.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ completada: false, fechaCompletada: null, canceladaEn: null, motivoCancelacion: null });
  });

  it("404 si el seguimiento no es de un prospecto suyo", async () => {
    p.prospecto.findFirst.mockResolvedValue(null);
    const res = await request(app).post("/seguimientos/sg1/completar").set(auth(comTok)).send({});
    expect(res.status).toBe(404);
  });

  it("borrar responde 204", async () => {
    p.seguimientoProspecto.delete.mockResolvedValue({});
    const res = await request(app).delete("/seguimientos/sg1").set(auth(comTok));
    expect(res.status).toBe(204);
  });
});

describe("agenda — pendientes por comercial", () => {
  beforeEach(() => {
    p.seguimientoProspecto.findMany.mockResolvedValue([]);
  });

  it("COMERCIAL queda acotado a comercialId = sí mismo, pendiente (completada:false, canceladaEn:null)", async () => {
    await request(app).get("/agenda").set(auth(comTok));
    const call = p.seguimientoProspecto.findMany.mock.calls[0][0];
    expect(call.where.comercialId).toBe("com1");
    expect(call.where.completada).toBe(false);
    expect(call.where.canceladaEn).toBeNull();
    expect(call.where.fechaProgramada).toHaveProperty("gte");
  });

  it("incluirCompletadas=true omite el filtro de estado (trae completadas/canceladas)", async () => {
    await request(app).get("/agenda?incluirCompletadas=true").set(auth(comTok));
    const call = p.seguimientoProspecto.findMany.mock.calls[0][0];
    expect(call.where.completada).toBeUndefined();
    expect(call.where.canceladaEn).toBeUndefined();
  });

  it("trae items y un bloque de vencidas cuando el rango arranca hoy", async () => {
    p.seguimientoProspecto.findMany
      .mockResolvedValueOnce([{ id: "hoy1" }]) // items del rango
      .mockResolvedValueOnce([{ id: "vieja1" }]); // vencidas
    const res = await request(app).get("/agenda").set(auth(comTok));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.vencidas).toHaveLength(1);
    const vencCall = p.seguimientoProspecto.findMany.mock.calls[1][0];
    expect(vencCall.where.fechaProgramada).toHaveProperty("lt");
  });

  it("ADMIN puede ver la agenda de un comercial concreto", async () => {
    await request(app).get("/agenda?comercialId=comB").set(auth(adminTok));
    expect(p.seguimientoProspecto.findMany.mock.calls[0][0].where.comercialId).toBe("comB");
  });
});

describe("equipo comercial — resumen (solo ADMIN)", () => {
  it("403 para un COMERCIAL", async () => {
    const res = await request(app).get("/equipo-comercial").set(auth(comTok));
    expect(res.status).toBe(403);
  });

  it("ADMIN ve cada comercial con sus contadores", async () => {
    p.usuario.findMany.mockResolvedValue([{ id: "com1", nombre: "Jaime", email: "j@x.co", activo: true, porcentajeComision: 10 }]);
    p.prospecto.groupBy.mockResolvedValue([
      { comercialId: "com1", estado: "NUEVO", _count: { _all: 3 } },
      { comercialId: "com1", estado: "GANADO", _count: { _all: 2 } },
    ]);
    p.seguimientoProspecto.groupBy.mockResolvedValue([{ comercialId: "com1", _count: { _all: 4 } }]);
    const res = await request(app).get("/equipo-comercial").set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: "com1", prospectos: 5, ganados: 2, pendientesAgenda: 4 });
  });

  it("sin comerciales no consulta agregados y devuelve []", async () => {
    p.usuario.findMany.mockResolvedValue([]);
    const res = await request(app).get("/equipo-comercial").set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(p.prospecto.groupBy).not.toHaveBeenCalled();
  });
});
