// Tests del módulo de NOTIFICACIONES con `fetch` MOCKEADO. NO tocan el proveedor
// real (correo/SMS/llamadas son de cobro). Verifican: URL/método/payload que se
// arma, la normalización de la respuesta, y que un fallo se traduzca a 502.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env";
import { enviarCorreo } from "../src/modules/notificaciones/correo.client";
import { enviarSms } from "../src/modules/notificaciones/sms.client";
import { consultarEstadoLlamada, llamar } from "../src/modules/notificaciones/llamadas.client";

const BASE = env.notificaciones.baseUrl;

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const bodyDe = (fn: ReturnType<typeof vi.fn>) => JSON.parse(fn.mock.calls[0][1].body);

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("correo.enviarCorreo", () => {
  it("postea a /email/enviar y normaliza { enviado, messageId }", async () => {
    const fn = mockFetch({ ok: true, message: "Correo enviado correctamente", messageId: "<abc@finova>" });
    const r = await enviarCorreo({ to: "x@y.com", subject: "Hola", html: "<p>hi</p>" });

    expect(r).toEqual({ enviado: true, messageId: "<abc@finova>" });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe(`${BASE}/email/enviar`);
    expect(init.method).toBe("POST");
    expect(bodyDe(fn)).toEqual({ to: "x@y.com", subject: "Hola", html: "<p>hi</p>" });
  });

  it("fallo del proveedor (500) → HttpError 502", async () => {
    mockFetch({ ok: false, error: "SMTP caído" }, 500);
    await expect(enviarCorreo({ to: "x@y.com", subject: "s", html: "h" })).rejects.toMatchObject({ status: 502 });
  });

  it("conexión caída → HttpError 502", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(enviarCorreo({ to: "x@y.com", subject: "s", html: "h" })).rejects.toMatchObject({ status: 502 });
  });
});

describe("sms.enviarSms", () => {
  it('message "Ok" → enviado true (+ defaults isPriority/isFlash false)', async () => {
    const fn = mockFetch({ message: "Ok" });
    const r = await enviarSms({ toNumber: "573105399184", content: "hola" });

    expect(r).toEqual({ enviado: true, mensajeProveedor: "Ok" });
    expect(fn.mock.calls[0][0]).toBe(`${BASE}/notificarViaSMS`);
    expect(bodyDe(fn)).toEqual({ toNumber: "573105399184", content: "hola", isPriority: false, isFlash: false });
  });

  it('message "Falló" → enviado false SIN lanzar (200 con fallo lógico)', async () => {
    mockFetch({ message: "Falló" });
    const r = await enviarSms({ toNumber: "573105399184", content: "hola" });
    expect(r).toEqual({ enviado: false, mensajeProveedor: "Falló" });
  });
});

describe("llamadas", () => {
  it("llamar → devuelve campaignId y solo manda los campos provistos", async () => {
    const fn = mockFetch({ ok: true, campaignId: "camp123", status: 200, dest: "573105399184" });
    const r = await llamar({ telefono: "3105399184", mensaje: "prueba" });

    expect(r).toEqual({ ok: true, campaignId: "camp123", dest: "573105399184" });
    expect(fn.mock.calls[0][0]).toBe(`${BASE}/go4/llamar`);
    // JSON.stringify omite los opcionales undefined:
    expect(bodyDe(fn)).toEqual({ telefono: "3105399184", mensaje: "prueba" });
  });

  it("consultarEstadoLlamada → mapea duracion_seg/termino", async () => {
    const fn = mockFetch({
      ok: true,
      campaignId: "camp123",
      estado: "answered",
      descripcion: "Contestó",
      termino: true,
      duracion_seg: 9,
      intento: 1,
      costo: 0,
    });
    const r = await consultarEstadoLlamada("camp123");

    expect(r).toMatchObject({ estado: "answered", termino: true, duracionSeg: 9, intento: 1, costo: 0 });
    expect(fn.mock.calls[0][0]).toBe(`${BASE}/go4/estado/camp123`);
  });
});
