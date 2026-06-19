import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock del cliente Prisma — los endpoints públicos no tocan la BD real.
vi.mock("../src/index", () => ({
  prisma: {
    plan: { findMany: vi.fn(), findUnique: vi.fn() },
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

describe("observabilidad", () => {
  it("GET /metrics expone métricas Prometheus (sin auth)", async () => {
    await request(app).get("/health"); // genera tráfico medible
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toContain("http_requests_total");
  });
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

describe("POST /publico/solicitud-cuenta (público, sin auth)", () => {
  const ok = { nombreEmpresa: "Despacho X", nombreContacto: "Ana Admin", email: "ana@x.co" };

  it("201 y crea un Prospecto pendiente (canalEntrada=WEB) con empresa+admin+plan", async () => {
    m.plan.findUnique.mockResolvedValue({ id: "plan-firma" });
    m.prospecto.create.mockResolvedValue({ id: "p1" });
    const res = await request(app).post("/publico/solicitud-cuenta").send({
      ...ok, nit: "900123", telefono: "300", emailEmpresa: "info@x.co", telefonoEmpresa: "601", planClave: "firma",
    });
    expect(res.status).toBe(201);
    const data = m.prospecto.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      nombreEmpresa: "Despacho X",
      numeroDocumento: "900123",
      nombreContacto: "Ana Admin",
      email: "ana@x.co",
      telefono: "300",
      canalEntrada: "WEB",
      planInteresId: "plan-firma",
    });
    // El correo/teléfono de empresa van a notas (no tienen columna propia).
    expect(data.notas).toContain("info@x.co");
    expect(data.notas).toContain("601");
    expect(m.plan.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { clave: "firma" } }));
  });

  it("plan inexistente → planInteresId null (no rompe)", async () => {
    m.plan.findUnique.mockResolvedValue(null);
    m.prospecto.create.mockResolvedValue({ id: "p2" });
    const res = await request(app).post("/publico/solicitud-cuenta").send({ ...ok, planClave: "no-existe" });
    expect(res.status).toBe(201);
    expect(m.prospecto.create.mock.calls[0][0].data.planInteresId).toBeNull();
  });

  it("honeypot lleno → no-op (200, no crea Prospecto)", async () => {
    const res = await request(app).post("/publico/solicitud-cuenta").send({ ...ok, website: "http://spam" });
    expect(res.status).toBe(200);
    expect(m.prospecto.create).not.toHaveBeenCalled();
  });

  it("correo del admin inválido → 400 y no crea", async () => {
    const res = await request(app).post("/publico/solicitud-cuenta").send({ ...ok, email: "no-es-correo" });
    expect(res.status).toBe(400);
    expect(m.prospecto.create).not.toHaveBeenCalled();
  });

  it("falta nombreContacto (admin) → 400", async () => {
    const res = await request(app).post("/publico/solicitud-cuenta").send({ nombreEmpresa: "X", email: "a@b.co" });
    expect(res.status).toBe(400);
    expect(m.prospecto.create).not.toHaveBeenCalled();
  });

  it("ignora estado/empresaId inyectados (solo usa los campos del schema)", async () => {
    m.plan.findUnique.mockResolvedValue(null);
    m.prospecto.create.mockResolvedValue({ id: "p3" });
    await request(app).post("/publico/solicitud-cuenta").send({ ...ok, estado: "GANADO", empresaId: "e1" });
    const data = m.prospecto.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("estado");
    expect(data).not.toHaveProperty("empresaId");
  });
});
