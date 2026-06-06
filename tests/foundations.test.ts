import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock del cliente Prisma — solo lo que tocan el motor de entitlements, la
// puerta de cupos y requirePermiso.
vi.mock("../src/index", () => ({
  prisma: {
    modulo: { findMany: vi.fn() },
    suscripcion: { findUnique: vi.fn() },
    permiso: { findUnique: vi.fn() },
    usuarioRolEmpresa: { count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "../src/index";
import { resolveEntitlements } from "../src/modules/entitlements/entitlements.service";
import { assertSeatAvailable } from "../src/modules/roles/roles.service";
import { requirePermiso } from "../src/middleware/auth";

const p = prisma as any;

// Construye una suscripción para el mock de suscripcion.findUnique.
function sub(o: {
  estado?: string;
  planModulos?: { modulo: { clave: string } }[];
  planCuotas?: { rolEmpresa: string; limite: number | null }[];
  modulos?: { modulo: { clave: string }; habilitado: boolean }[];
  cuotas?: { rolEmpresa: string; limite: number | null }[];
}) {
  return {
    estado: o.estado ?? "ACTIVA",
    plan: { modulos: o.planModulos ?? [], cuotas: o.planCuotas ?? [] },
    modulos: o.modulos ?? [],
    cuotas: o.cuotas ?? [],
  };
}

// Ejecuta un middleware envuelto en asyncHandler (no devuelve promesa) y espera
// a que drenen los microtasks. Devuelve el mock de `next` para inspeccionarlo.
async function runMw(mw: any, req: any) {
  const next = vi.fn();
  mw(req, {}, next);
  await new Promise((r) => setImmediate(r));
  return next;
}

beforeEach(() => {
  vi.clearAllMocks();
  p.modulo.findMany.mockResolvedValue([]); // baseline vacío por defecto
  p.$queryRaw.mockResolvedValue([]);
});

describe("resolveEntitlements", () => {
  it("ACTIVA: baseline + módulos del plan; cupos del plan con NULL=Infinity", async () => {
    p.modulo.findMany.mockResolvedValue([{ clave: "reportes" }, { clave: "judicial" }]);
    p.suscripcion.findUnique.mockResolvedValue(
      sub({
        planModulos: [{ modulo: { clave: "contable" } }],
        planCuotas: [
          { rolEmpresa: "JURIDICO", limite: 5 },
          { rolEmpresa: "ADMINISTRADOR", limite: null },
        ],
      }),
    );
    const ent = await resolveEntitlements("e1");
    expect([...ent.modulosHabilitados].sort()).toEqual(["contable", "judicial", "reportes"]);
    expect(ent.cuotas.get("JURIDICO" as any)).toBe(5);
    expect(ent.cuotas.get("ADMINISTRADOR" as any)).toBe(Infinity);
    expect(ent.cuotas.get("CONTABLE" as any)).toBe(0); // sin cuota del plan → 0
  });

  it("overrides por empresa pisan módulo y cupo", async () => {
    p.modulo.findMany.mockResolvedValue([{ clave: "reportes" }]);
    p.suscripcion.findUnique.mockResolvedValue(
      sub({
        planModulos: [{ modulo: { clave: "contable" } }],
        planCuotas: [{ rolEmpresa: "JURIDICO", limite: 5 }],
        modulos: [
          { modulo: { clave: "comercial" }, habilitado: true },
          { modulo: { clave: "contable" }, habilitado: false },
        ],
        cuotas: [{ rolEmpresa: "JURIDICO", limite: 8 }],
      }),
    );
    const ent = await resolveEntitlements("e1");
    expect(ent.modulosHabilitados.has("comercial")).toBe(true);
    expect(ent.modulosHabilitados.has("contable")).toBe(false); // override lo apagó
    expect(ent.modulosHabilitados.has("reportes")).toBe(true); // baseline intacto
    expect(ent.cuotas.get("JURIDICO" as any)).toBe(8);
  });

  it("suscripción no activa → solo baseline y cupos 0", async () => {
    p.modulo.findMany.mockResolvedValue([{ clave: "reportes" }]);
    p.suscripcion.findUnique.mockResolvedValue(
      sub({ estado: "SUSPENDIDA", planModulos: [{ modulo: { clave: "contable" } }], planCuotas: [{ rolEmpresa: "JURIDICO", limite: 5 }] }),
    );
    const ent = await resolveEntitlements("e1");
    expect([...ent.modulosHabilitados]).toEqual(["reportes"]);
    expect(ent.cuotas.get("JURIDICO" as any)).toBe(0);
  });

  it("sin suscripción → solo baseline y cupos 0", async () => {
    p.modulo.findMany.mockResolvedValue([{ clave: "reportes" }]);
    p.suscripcion.findUnique.mockResolvedValue(null);
    const ent = await resolveEntitlements("e1");
    expect([...ent.modulosHabilitados]).toEqual(["reportes"]);
    expect(ent.cuotas.get("ADMINISTRADOR" as any)).toBe(0);
  });
});

describe("assertSeatAvailable (puerta de cupos)", () => {
  it("pasa si las sillas usadas < cupo", async () => {
    p.suscripcion.findUnique.mockResolvedValue(sub({ planCuotas: [{ rolEmpresa: "JURIDICO", limite: 2 }] }));
    p.usuarioRolEmpresa.count.mockResolvedValue(1);
    await expect(assertSeatAvailable(p, "e1", "JURIDICO" as any)).resolves.toBeUndefined();
  });

  it("409 si las sillas usadas >= cupo", async () => {
    p.suscripcion.findUnique.mockResolvedValue(sub({ planCuotas: [{ rolEmpresa: "JURIDICO", limite: 2 }] }));
    p.usuarioRolEmpresa.count.mockResolvedValue(2);
    await expect(assertSeatAvailable(p, "e1", "JURIDICO" as any)).rejects.toMatchObject({ status: 409 });
  });

  it("ilimitado (NULL) nunca rechaza y no cuenta", async () => {
    p.suscripcion.findUnique.mockResolvedValue(sub({ planCuotas: [{ rolEmpresa: "JURIDICO", limite: null }] }));
    await expect(assertSeatAvailable(p, "e1", "JURIDICO" as any)).resolves.toBeUndefined();
    expect(p.usuarioRolEmpresa.count).not.toHaveBeenCalled();
  });
});

describe("requirePermiso", () => {
  const reqBase = { empresaId: "e1", esAdminEmpresa: false, rolesEmpresa: [] as string[] };

  it("403 si el módulo del permiso no está contratado", async () => {
    p.permiso.findUnique.mockResolvedValue({ modulo: { clave: "contable" }, roles: [{ rolEmpresa: "COMERCIAL" }] });
    p.suscripcion.findUnique.mockResolvedValue(sub({})); // contable NO contratado
    const next = await runMw(requirePermiso("cliente.crear"), { ...reqBase });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403, message: "Módulo no contratado" }));
  });

  it("esAdminEmpresa corta la puerta RBAC", async () => {
    p.permiso.findUnique.mockResolvedValue({ modulo: { clave: "comercial" }, roles: [{ rolEmpresa: "COMERCIAL" }] });
    p.suscripcion.findUnique.mockResolvedValue(sub({ planModulos: [{ modulo: { clave: "comercial" } }] }));
    const next = await runMw(requirePermiso("cliente.crear"), { ...reqBase, esAdminEmpresa: true });
    expect(next).toHaveBeenCalledWith(); // sin error
  });

  it("403 si ningún RolEmpresa concede el permiso", async () => {
    p.permiso.findUnique.mockResolvedValue({ modulo: { clave: "comercial" }, roles: [{ rolEmpresa: "COMERCIAL" }] });
    p.suscripcion.findUnique.mockResolvedValue(sub({ planModulos: [{ modulo: { clave: "comercial" } }] }));
    const next = await runMw(requirePermiso("cliente.crear"), { ...reqBase, rolesEmpresa: ["JURIDICO"] });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });

  it("pasa si un RolEmpresa concede el permiso", async () => {
    p.permiso.findUnique.mockResolvedValue({ modulo: { clave: "comercial" }, roles: [{ rolEmpresa: "COMERCIAL" }] });
    p.suscripcion.findUnique.mockResolvedValue(sub({ planModulos: [{ modulo: { clave: "comercial" } }] }));
    const next = await runMw(requirePermiso("cliente.crear"), { ...reqBase, rolesEmpresa: ["COMERCIAL"] });
    expect(next).toHaveBeenCalledWith();
  });

  it("400 si el usuario no pertenece a una empresa", async () => {
    const next = await runMw(requirePermiso("cliente.crear"), { empresaId: null, esAdminEmpresa: false, rolesEmpresa: [] });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
  });
});
