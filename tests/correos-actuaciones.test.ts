// Test del correo de NOVEDADES (best-effort) con enviarCorreo mockeado.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/notificaciones/correo.client", () => ({ enviarCorreo: vi.fn() }));

import { enviarCorreo } from "../src/modules/notificaciones/correo.client";
import { enviarNovedadActuaciones } from "../src/modules/notificaciones/correos-actuaciones";

const mockEnviar = enviarCorreo as unknown as ReturnType<typeof vi.fn>;
const base = { to: "a@b.com", nombre: "Ana", procesoTitulo: "Caso X", radicado: "660...", nuevas: 2, ultima: "MANDAMIENTO DE PAGO" };

beforeEach(() => mockEnviar.mockClear());

describe("enviarNovedadActuaciones", () => {
  it("envía al responsable con asunto del proceso y devuelve true", async () => {
    mockEnviar.mockResolvedValueOnce({ enviado: true, messageId: "x" });
    const ok = await enviarNovedadActuaciones(base);
    expect(ok).toBe(true);
    const arg = mockEnviar.mock.calls[0][0];
    expect(arg).toMatchObject({ to: "a@b.com" });
    expect(arg.subject).toContain("Caso X");
    expect(arg.html).toContain("MANDAMIENTO DE PAGO");
  });

  it("un fallo del transporte NO lanza y devuelve false", async () => {
    mockEnviar.mockRejectedValueOnce(new Error("502"));
    await expect(enviarNovedadActuaciones(base)).resolves.toBe(false);
  });
});
