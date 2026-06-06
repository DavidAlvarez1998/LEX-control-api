import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock del cliente Prisma — los tests no tocan la BD real.
vi.mock("../src/index", () => ({
  prisma: {
    usuario: { findUnique: vi.fn(), findFirst: vi.fn() },
    areaPractica: { findMany: vi.fn() },
    tipoProceso: { findUnique: vi.fn(), findMany: vi.fn() },
    proceso: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    litigante: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    parteProceso: { create: vi.fn() },
    etapaProceso: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";

const app = createApp();
const m = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const usuario = m.usuario;
const tipoProceso = m.tipoProceso;
const proceso = m.proceso;
const areaPractica = m.areaPractica;

const token = signToken({ sub: "u1", rol: "USUARIO" });
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeEach(() => {
  vi.clearAllMocks();
  // requireAuth: el portador es un USUARIO del despacho "emp1".
  usuario.findUnique.mockResolvedValue({
    activo: true,
    activationToken: null,
    tokenVersion: 0,
    empresaId: "emp1",
    esAdminEmpresa: false,
  });
});

const tipoCivil = {
  id: "tt1",
  empresaId: null,
  esquemaVersion: 1,
  jurisdiccion: "ORDINARIA_CIVIL",
  esquemaFormulario: [
    { key: "valor", label: "Valor", tipo: "numero", requerido: true },
  ],
  etapas: [
    { key: "demanda", nombre: "Demanda", orden: 1 },
    { key: "fallo", nombre: "Fallo", orden: 2, reglas: { camposRequeridos: ["valor"] } },
  ],
};

describe("auth", () => {
  it("rechaza sin token (401)", async () => {
    const res = await request(app).get("/catalogo/areas");
    expect(res.status).toBe(401);
  });
});

describe("catálogo de áreas", () => {
  it("lista las áreas activas (200)", async () => {
    areaPractica.findMany.mockResolvedValue([{ slug: "civil", nombre: "Civil" }]);
    const res = await request(app).get("/catalogo/areas").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe("POST /procesos — validación del formulario dinámico", () => {
  it("400 cuando falta un campo requerido", async () => {
    tipoProceso.findUnique.mockResolvedValue(tipoCivil);
    const res = await request(app)
      .post("/procesos")
      .set(auth(token))
      .send({ tipoProcesoId: "tt1", titulo: "Caso", datos: {} });
    expect(res.status).toBe(400);
    expect(res.body.error.issues.faltantes).toContain("Valor");
  });

  it("400 cuando hay una clave no declarada en el esquema", async () => {
    tipoProceso.findUnique.mockResolvedValue(tipoCivil);
    const res = await request(app)
      .post("/procesos")
      .set(auth(token))
      .send({ tipoProcesoId: "tt1", titulo: "Caso", datos: { valor: "100", basura: "x" } });
    expect(res.status).toBe(400);
  });

  it("404 cuando el tipo es de otro despacho", async () => {
    tipoProceso.findUnique.mockResolvedValue({ ...tipoCivil, empresaId: "otra" });
    const res = await request(app)
      .post("/procesos")
      .set(auth(token))
      .send({ tipoProcesoId: "tt1", titulo: "Caso", datos: { valor: "100" } });
    expect(res.status).toBe(404);
  });
});

describe("scoping multi-tenant", () => {
  it("GET /procesos/:id de otro despacho devuelve 404", async () => {
    proceso.findFirst.mockResolvedValue(null); // findFirst usa { id, empresaId }
    const res = await request(app).get("/procesos/otro").set(auth(token));
    expect(res.status).toBe(404);
    // La consulta filtró por el empresaId del portador.
    expect(proceso.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ empresaId: "emp1" }) }),
    );
  });

  it("GET /procesos lista paginada del despacho (200)", async () => {
    proceso.count.mockResolvedValue(0);
    proceso.findMany.mockResolvedValue([]);
    const res = await request(app).get("/procesos").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, page: 1 });
  });
});

describe("PATCH /procesos/:id/etapa — rule-gated", () => {
  it("400 cuando la etapa destino exige un campo ausente", async () => {
    proceso.findFirst.mockResolvedValue({
      id: "tr1",
      estado: "ABIERTO",
      datos: {}, // sin "valor"
      tipoProceso: { etapas: tipoCivil.etapas },
    });
    const res = await request(app)
      .patch("/procesos/tr1/etapa")
      .set(auth(token))
      .send({ etapaKey: "fallo" });
    expect(res.status).toBe(400);
    expect(res.body.error.issues.faltantes).toContain("valor");
  });
});
