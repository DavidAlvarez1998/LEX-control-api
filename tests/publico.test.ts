import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock del cliente Prisma — los endpoints públicos no tocan la BD real.
vi.mock("../src/index", () => ({
  prisma: {
    plan: { findMany: vi.fn(), findUnique: vi.fn() },
    prospecto: { create: vi.fn() },
    usuario: { findUnique: vi.fn(), create: vi.fn() },
    empresa: { findUnique: vi.fn(), create: vi.fn() },
    suscripcion: { create: vi.fn() },
    usuarioRolEmpresa: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// Mock del transporte de correo: el alta autoservicio dispara la invitación; ningún
// test toca la red.
vi.mock("../src/modules/notificaciones/correo.client", () => ({
  enviarCorreo: vi.fn().mockResolvedValue({ enviado: true, messageId: "test" }),
}));

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/index";

const app = createApp();
const m = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

beforeEach(() => {
  vi.clearAllMocks();
  // $transaction(fn) ejecuta el callback con el MISMO mock (tx = prisma).
  (m.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: (tx: typeof prisma) => unknown) => fn(prisma),
  );
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
        modulos: [
          { modulo: { clave: "comercial", nombre: "Módulo comercial" } },
          { modulo: { clave: "contable", nombre: "Módulo contable" } },
        ],
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
      modulos: ["Módulo comercial", "Módulo contable"],
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

describe("POST /publico/solicitud-cuenta (alta autoservicio, sin auth)", () => {
  const ok = {
    nombreEmpresa: "Despacho X", nit: "900123", email: "ana@x.co",
    telefono: "3001234567", nombreContacto: "Ana Admin",
  };

  /** Configura los mocks para un alta feliz (sin duplicados, plan trial presente). */
  function arrangeHappy() {
    m.usuario.findUnique.mockResolvedValue(null); // email libre
    m.empresa.findUnique.mockResolvedValue(null);  // NIT libre
    m.plan.findUnique.mockResolvedValue({ id: "plan-trial" });
    m.empresa.create.mockResolvedValue({ id: "emp1" });
    m.suscripcion.create.mockResolvedValue({ id: "sus1" });
    m.usuario.create.mockResolvedValue({ id: "usr1", email: "ana@x.co", nombre: "Ana Admin", rol: "USUARIO" });
    m.usuarioRolEmpresa.create.mockResolvedValue({ id: "ure1" });
    m.prospecto.create.mockResolvedValue({ id: "p1" });
  }

  it("201: crea Empresa + Suscripción(trial) + Usuario(ADMINISTRADOR pendiente) + Prospecto GANADO", async () => {
    arrangeHappy();
    const res = await request(app).post("/publico/solicitud-cuenta").send({ ...ok, tarjeta: "TP-123" });
    expect(res.status).toBe(201);

    // Empresa: nombre + NIT→rfc + correo + activa
    expect(m.empresa.create.mock.calls[0][0].data).toMatchObject({
      nombre: "Despacho X", rfc: "900123", email: "ana@x.co", activo: true,
    });
    // Suscripción al plan trial resuelto server-side
    expect(m.suscripcion.create).toHaveBeenCalledWith({ data: { empresaId: "emp1", planId: "plan-trial", estado: "ACTIVA" } });
    // Usuario admin: rol USUARIO + esAdminEmpresa + telefono + tarjeta + token de activación
    const u = m.usuario.create.mock.calls[0][0].data;
    expect(u).toMatchObject({
      email: "ana@x.co", nombre: "Ana Admin", empresaId: "emp1", rol: "USUARIO",
      esAdminEmpresa: true, telefono: "3001234567", tarjetaProfesional: "TP-123",
    });
    expect(u.activationToken).toBeTruthy();
    expect(u.activationExpires).toBeInstanceOf(Date);
    // Rol de empresa ADMINISTRADOR
    expect(m.usuarioRolEmpresa.create).toHaveBeenCalledWith({ data: { usuarioId: "usr1", rolEmpresa: "ADMINISTRADOR", empresaId: "emp1" } });
    // Prospecto GANADO ligado a la empresa, canal WEB, sin comercial
    const p = m.prospecto.create.mock.calls[0][0].data;
    expect(p).toMatchObject({ canalEntrada: "WEB", estado: "GANADO", empresaId: "emp1", planVendidoId: "plan-trial" });
    expect(p.comercialId ?? null).toBeNull();
  });

  it("plan trial inexistente → crea empresa SIN suscripción (degrada, 201)", async () => {
    arrangeHappy();
    m.plan.findUnique.mockResolvedValue(null);
    const res = await request(app).post("/publico/solicitud-cuenta").send(ok);
    expect(res.status).toBe(201);
    expect(m.empresa.create).toHaveBeenCalled();
    expect(m.suscripcion.create).not.toHaveBeenCalled();
    expect(m.prospecto.create.mock.calls[0][0].data.planVendidoId).toBeNull();
  });

  it("correo ya registrado → 409 y no crea nada", async () => {
    m.usuario.findUnique.mockResolvedValue({ id: "ya" });
    const res = await request(app).post("/publico/solicitud-cuenta").send(ok);
    expect(res.status).toBe(409);
    expect(m.empresa.create).not.toHaveBeenCalled();
    expect(m.usuario.create).not.toHaveBeenCalled();
  });

  it("NIT ya registrado → 409 y no crea nada", async () => {
    m.usuario.findUnique.mockResolvedValue(null);
    m.empresa.findUnique.mockResolvedValue({ id: "ya" });
    const res = await request(app).post("/publico/solicitud-cuenta").send(ok);
    expect(res.status).toBe(409);
    expect(m.empresa.create).not.toHaveBeenCalled();
  });

  it("honeypot lleno → no-op (200, no crea nada)", async () => {
    const res = await request(app).post("/publico/solicitud-cuenta").send({ ...ok, website: "http://spam" });
    expect(res.status).toBe(200);
    expect(m.empresa.create).not.toHaveBeenCalled();
    expect(m.usuario.create).not.toHaveBeenCalled();
  });

  it("correo inválido → 400 y no crea", async () => {
    const res = await request(app).post("/publico/solicitud-cuenta").send({ ...ok, email: "no-es-correo" });
    expect(res.status).toBe(400);
    expect(m.empresa.create).not.toHaveBeenCalled();
  });

  it("faltan campos requeridos (nit/telefono/nombreContacto) → 400", async () => {
    const res = await request(app).post("/publico/solicitud-cuenta").send({ nombreEmpresa: "X", email: "a@b.co" });
    expect(res.status).toBe(400);
    expect(m.empresa.create).not.toHaveBeenCalled();
  });

  it("ignora estado/rol/empresaId/planId inyectados (solo campos del schema)", async () => {
    arrangeHappy();
    await request(app).post("/publico/solicitud-cuenta").send({ ...ok, estado: "PERDIDO", rol: "ADMIN", empresaId: "hack", planId: "hack" });
    // El usuario nace USUARIO (no ADMIN) y el prospecto GANADO (no el inyectado).
    expect(m.usuario.create.mock.calls[0][0].data.rol).toBe("USUARIO");
    expect(m.prospecto.create.mock.calls[0][0].data.estado).toBe("GANADO");
  });
});

describe("POST /publico/contacto (público, sin auth)", () => {
  const ok = { nombreContacto: "Luis Visitante", email: "luis@x.co", mensaje: "Quiero info" };

  it("201 y crea un Prospecto WEB SIN asignar (comercialId ausente) con el mensaje en notas", async () => {
    m.prospecto.create.mockResolvedValue({ id: "c1" });
    const res = await request(app).post("/publico/contacto").send({ ...ok, nombreEmpresa: "Despacho L", telefono: "300" });
    expect(res.status).toBe(201);
    const data = m.prospecto.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ nombreEmpresa: "Despacho L", nombreContacto: "Luis Visitante", email: "luis@x.co", telefono: "300", canalEntrada: "WEB" });
    expect(data.comercialId ?? null).toBeNull(); // sin asignar
    expect(data.notas).toContain("Quiero info");
  });

  it("sin empresa → usa el nombre del contacto como nombreEmpresa", async () => {
    m.prospecto.create.mockResolvedValue({ id: "c2" });
    await request(app).post("/publico/contacto").send(ok);
    expect(m.prospecto.create.mock.calls[0][0].data.nombreEmpresa).toBe("Luis Visitante");
  });

  it("solo teléfono (sin correo) → 201 (basta un medio)", async () => {
    m.prospecto.create.mockResolvedValue({ id: "c3" });
    const res = await request(app).post("/publico/contacto").send({ nombreContacto: "Sin Correo", telefono: "3001234" });
    expect(res.status).toBe(201);
  });

  it("sin correo ni teléfono → 400 y no crea", async () => {
    const res = await request(app).post("/publico/contacto").send({ nombreContacto: "Nadie" });
    expect(res.status).toBe(400);
    expect(m.prospecto.create).not.toHaveBeenCalled();
  });

  it("honeypot lleno → no-op (200, no crea)", async () => {
    const res = await request(app).post("/publico/contacto").send({ ...ok, website: "http://spam" });
    expect(res.status).toBe(200);
    expect(m.prospecto.create).not.toHaveBeenCalled();
  });
});
