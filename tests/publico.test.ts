import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock del cliente Prisma — los endpoints públicos no tocan la BD real.
vi.mock("../src/index", () => ({
  prisma: {
    plan: { findMany: vi.fn() },
    prospecto: { create: vi.fn() },
  },
}));

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/index";

const app = createApp();
const m = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /publico/planes (público, sin auth)", () => {
  it("200 sin token y devuelve la proyección mínima (sin ids ni campos internos)", async () => {
    m.plan.findMany.mockResolvedValue([
      {
        clave: "firma",
        nombre: "Firma",
        descripcion: "Para despachos pequeños",
        precioMensual: { toString: () => "120000" } as never,
        modulos: [{ modulo: { clave: "comercial" } }, { modulo: { clave: "contable" } }],
        cuotas: [{ rolEmpresa: "JURIDICO", limite: 5 }, { rolEmpresa: "CONTABLE", limite: 1 }],
      },
    ]);

    const res = await request(app).get("/publico/planes");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const p = res.body[0];
    expect(p).toEqual({
      clave: "firma",
      nombre: "Firma",
      descripcion: "Para despachos pequeños",
      precioMensual: 120000,
      modulos: ["comercial", "contable"],
      cuotas: { JURIDICO: 5, CONTABLE: 1 },
    });
    expect(p).not.toHaveProperty("id");
    expect(p).not.toHaveProperty("suscripciones");

    // Solo activos, ordenados por `orden`.
    expect(m.plan.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { activo: true }, orderBy: { orden: "asc" } }));
  });

  it("200 con lista vacía si no hay planes activos", async () => {
    m.plan.findMany.mockResolvedValue([]);
    const res = await request(app).get("/publico/planes");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("POST /publico/solicitar-demo (público, sin auth)", () => {
  const ok = { nombreEmpresa: "Despacho X", nombreContacto: "Ana", email: "ana@x.co" };

  it("201 y crea un Prospecto canalEntrada=WEB, estado por defecto", async () => {
    m.prospecto.create.mockResolvedValue({ id: "p1" });
    const res = await request(app).post("/publico/solicitar-demo").send({ ...ok, telefono: "300", mensaje: "Quiero demo" });
    expect(res.status).toBe(201);
    expect(m.prospecto.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        nombreEmpresa: "Despacho X",
        nombreContacto: "Ana",
        email: "ana@x.co",
        telefono: "300",
        canalEntrada: "WEB",
        notas: "Quiero demo",
      }),
    });
  });

  it("honeypot lleno → no-op (200, no crea Prospecto)", async () => {
    const res = await request(app).post("/publico/solicitar-demo").send({ ...ok, website: "http://spam" });
    expect(res.status).toBe(200);
    expect(m.prospecto.create).not.toHaveBeenCalled();
  });

  it("email inválido → 400 y no crea", async () => {
    const res = await request(app).post("/publico/solicitar-demo").send({ ...ok, email: "no-es-correo" });
    expect(res.status).toBe(400);
    expect(m.prospecto.create).not.toHaveBeenCalled();
  });

  it("falta nombreContacto → 400", async () => {
    const res = await request(app).post("/publico/solicitar-demo").send({ nombreEmpresa: "X", email: "a@b.co" });
    expect(res.status).toBe(400);
    expect(m.prospecto.create).not.toHaveBeenCalled();
  });

  it("ignora estado/empresaId inyectados (solo usa los campos del schema)", async () => {
    m.prospecto.create.mockResolvedValue({ id: "p2" });
    await request(app).post("/publico/solicitar-demo").send({ ...ok, estado: "GANADO", empresaId: "e1" });
    const data = m.prospecto.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("estado");
    expect(data).not.toHaveProperty("empresaId");
  });
});
