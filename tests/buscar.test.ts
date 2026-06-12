import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock Prisma. /buscar pasa por requireAuth (usuario.findUnique) y, para el
// usuario de despacho, tienePermiso → resolveEntitlements (modulo.findMany +
// suscripcion.findUnique) + permiso.findUnique. Luego consulta las entidades.
vi.mock("../src/index", () => {
  const prisma: any = {
    usuario: { findUnique: vi.fn() },
    permiso: { findUnique: vi.fn() },
    modulo: { findMany: vi.fn() },
    suscripcion: { findUnique: vi.fn() },
    prospecto: { findMany: vi.fn() },
    empresa: { findMany: vi.fn() },
    cliente: { findMany: vi.fn() },
    proceso: { findMany: vi.fn() },
  };
  return { prisma };
});

import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";

const app = createApp();
const p = prisma as any;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const adminToken = signToken({ sub: "adm1", rol: "ADMIN" });
const comToken = signToken({ sub: "com1", rol: "COMERCIAL" });
const juridicoToken = signToken({ sub: "jur1", rol: "USUARIO" });
const contableToken = signToken({ sub: "con1", rol: "USUARIO" });

// Cuentas para requireAuth, indexadas por sub.
const CUENTAS: Record<string, any> = {
  adm1: { activo: true, activationToken: null, tokenVersion: 0, empresaId: null, esAdminEmpresa: false, empresa: null, rolesEmpresa: [] },
  com1: { activo: true, activationToken: null, tokenVersion: 0, empresaId: null, esAdminEmpresa: false, empresa: null, rolesEmpresa: [] },
  jur1: { activo: true, activationToken: null, tokenVersion: 0, empresaId: "eA", esAdminEmpresa: false, empresa: { activo: true }, rolesEmpresa: [{ rolEmpresa: "JURIDICO" }] },
  con1: { activo: true, activationToken: null, tokenVersion: 0, empresaId: "eA", esAdminEmpresa: false, empresa: { activo: true }, rolesEmpresa: [{ rolEmpresa: "CONTABLE" }] },
};

beforeEach(() => {
  vi.clearAllMocks();
  p.usuario.findUnique.mockImplementation(({ where }: any) => Promise.resolve(CUENTAS[where.id] ?? null));
  // Entitlements: judicial es baseline (siempre); el plan ACTIVO trae comercial.
  p.modulo.findMany.mockResolvedValue([{ clave: "judicial" }]);
  p.suscripcion.findUnique.mockResolvedValue({
    estado: "ACTIVA",
    plan: { modulos: [{ modulo: { clave: "comercial" } }], cuotas: [] },
    modulos: [],
    cuotas: [],
  });
  // RBAC por permiso (módulo + roles que lo conceden), según seed-foundations.
  p.permiso.findUnique.mockImplementation(({ where }: any) => {
    if (where.clave === "cliente.ver")
      return Promise.resolve({ modulo: { clave: "comercial" }, roles: [{ rolEmpresa: "ADMINISTRADOR" }, { rolEmpresa: "COMERCIAL" }, { rolEmpresa: "CONTABLE" }, { rolEmpresa: "JURIDICO" }] });
    if (where.clave === "proceso.ver")
      return Promise.resolve({ modulo: { clave: "judicial" }, roles: [{ rolEmpresa: "JURIDICO" }, { rolEmpresa: "COMERCIAL" }, { rolEmpresa: "ADMINISTRADOR" }] });
    return Promise.resolve(null);
  });
  p.prospecto.findMany.mockResolvedValue([]);
  p.empresa.findMany.mockResolvedValue([]);
  p.cliente.findMany.mockResolvedValue([]);
  p.proceso.findMany.mockResolvedValue([]);
});

describe("autorización y entrada", () => {
  it("401 sin token", async () => {
    const res = await request(app).get("/buscar?q=ana");
    expect(res.status).toBe(401);
  });

  it("q de menos de 2 chars → vacío sin tocar la BD", async () => {
    const res = await request(app).get("/buscar?q=a").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.resultados).toEqual([]);
    expect(p.prospecto.findMany).not.toHaveBeenCalled();
    expect(p.empresa.findMany).not.toHaveBeenCalled();
  });
});

describe("staff de plataforma", () => {
  it("ADMIN busca prospectos Y empresas", async () => {
    p.prospecto.findMany.mockResolvedValue([{ id: "pr1", nombreEmpresa: "Acme", nombreContacto: "Ana" }]);
    p.empresa.findMany.mockResolvedValue([{ id: "e9", nombre: "Acme SAS", rfc: "900" }]);
    const res = await request(app).get("/buscar?q=acme").set(auth(adminToken));
    expect(res.status).toBe(200);
    const tipos = res.body.resultados.map((r: any) => r.tipo);
    expect(tipos).toContain("prospecto");
    expect(tipos).toContain("empresa");
    // ADMIN no se acota por comercialId.
    expect(p.prospecto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ comercialId: expect.anything() }) }),
    );
  });

  it("COMERCIAL ve solo SUS prospectos y NO empresas", async () => {
    p.prospecto.findMany.mockResolvedValue([{ id: "pr1", nombreEmpresa: "Acme", nombreContacto: "Ana" }]);
    const res = await request(app).get("/buscar?q=acme").set(auth(comToken));
    expect(res.status).toBe(200);
    expect(p.empresa.findMany).not.toHaveBeenCalled();
    expect(p.prospecto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ comercialId: "com1" }) }),
    );
    expect(res.body.resultados.every((r: any) => r.tipo === "prospecto")).toBe(true);
  });
});

describe("usuario de despacho", () => {
  it("JURIDICO ve clientes y procesos, acotados a su empresa; NO prospectos/empresas", async () => {
    p.cliente.findMany.mockResolvedValue([{ id: "c1", nombre: "Ana", numeroDocumento: "123" }]);
    p.proceso.findMany.mockResolvedValue([{ id: "j1", titulo: "Tutela", codigoInterno: "CI-1" }]);
    const res = await request(app).get("/buscar?q=ana").set(auth(juridicoToken));
    expect(res.status).toBe(200);
    const tipos = res.body.resultados.map((r: any) => r.tipo);
    expect(tipos).toContain("cliente");
    expect(tipos).toContain("proceso");
    expect(p.prospecto.findMany).not.toHaveBeenCalled();
    expect(p.empresa.findMany).not.toHaveBeenCalled();
    expect(p.cliente.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ empresaId: "eA" }) }),
    );
    expect(p.proceso.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ empresaId: "eA" }) }),
    );
  });

  it("CONTABLE ve clientes pero NO procesos (sin proceso.ver)", async () => {
    p.cliente.findMany.mockResolvedValue([{ id: "c1", nombre: "Ana", numeroDocumento: "123" }]);
    const res = await request(app).get("/buscar?q=ana").set(auth(contableToken));
    expect(res.status).toBe(200);
    expect(p.cliente.findMany).toHaveBeenCalled();
    expect(p.proceso.findMany).not.toHaveBeenCalled();
    expect(res.body.resultados.every((r: any) => r.tipo === "cliente")).toBe(true);
  });
});
