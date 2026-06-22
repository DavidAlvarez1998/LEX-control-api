import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock del transporte de correo: ningún test toca la red.
vi.mock("../src/modules/notificaciones/correo.client", () => ({
  enviarCorreo: vi.fn(),
}));

import { enviarCorreo } from "../src/modules/notificaciones/correo.client";
import { enviarInvitacionCuenta, enviarResetCuenta } from "../src/modules/notificaciones/correos-cuenta";
import { plantillaInvitacion, plantillaReset } from "../src/modules/notificaciones/plantillas-cuenta";

const mockEnviar = enviarCorreo as unknown as ReturnType<typeof vi.fn>;
const URL = "http://localhost:3001/activar?token=abc123";

describe("plantillas de cuenta (puras)", () => {
  it("invitación: incluye el link, no deja placeholders y trae subject", () => {
    const { subject, html } = plantillaInvitacion({ nombre: "Ana", activationUrl: URL, contexto: "empresa" });
    expect(subject).not.toHaveLength(0);
    expect(html).toContain(URL);
    expect(html).toContain("Ana");
    expect(html).not.toContain("[[falta:");
    expect(html).not.toContain("undefined");
  });

  it("invitación: el copy varía por contexto", () => {
    const admin = plantillaInvitacion({ nombre: "A", activationUrl: URL, contexto: "admin" }).html;
    const comercial = plantillaInvitacion({ nombre: "A", activationUrl: URL, contexto: "comercial" }).html;
    const empresa = plantillaInvitacion({ nombre: "A", activationUrl: URL, contexto: "empresa" }).html;
    expect(admin).toContain("administrador");
    expect(comercial).toContain("comercial");
    expect(empresa).toContain("equipo");
  });

  it("reset: incluye el link y subject propio", () => {
    const { subject, html } = plantillaReset({ nombre: "Beto", activationUrl: URL });
    expect(subject.toLowerCase()).toContain("contraseña");
    expect(html).toContain(URL);
    expect(html).not.toContain("[[falta:");
  });
});

describe("envoltorio best-effort", () => {
  beforeEach(() => mockEnviar.mockClear());

  it("invitación: llama enviarCorreo con el to correcto y devuelve true si confirmó", async () => {
    mockEnviar.mockResolvedValueOnce({ enviado: true, messageId: "x" });
    const ok = await enviarInvitacionCuenta({ to: "a@b.com", nombre: "Ana", activationUrl: URL, contexto: "empresa" });
    expect(ok).toBe(true);
    expect(mockEnviar).toHaveBeenCalledTimes(1);
    expect(mockEnviar.mock.calls[0][0]).toMatchObject({ to: "a@b.com" });
  });

  it("propaga enviado=false sin lanzar cuando el proveedor no confirma", async () => {
    mockEnviar.mockResolvedValueOnce({ enviado: false, messageId: null });
    const ok = await enviarResetCuenta({ to: "a@b.com", nombre: "Ana", activationUrl: URL });
    expect(ok).toBe(false);
  });

  it("un fallo del transporte NO lanza y devuelve false", async () => {
    // El proveedor cae (502): enviarCorreo rechaza → el envoltorio lo atrapa.
    mockEnviar.mockRejectedValueOnce(new Error("502 SES caído"));
    await expect(
      enviarInvitacionCuenta({ to: "a@b.com", nombre: "Ana", activationUrl: URL, contexto: "admin" }),
    ).resolves.toBe(false);
  });
});
