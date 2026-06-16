import { describe, expect, it } from "vitest";
import { cifrarCredencial, descifrarCredencial } from "../src/modules/integraciones/crypto";
import { mockActuacionesAdapter } from "../src/modules/integraciones/mockActuaciones.client";

describe("crypto de credenciales (AES-256-GCM)", () => {
  it("cifra y descifra (round-trip)", () => {
    const secreto = "api-key-super-secreta-123";
    const sobre = cifrarCredencial(secreto);
    expect(sobre).not.toContain(secreto); // nunca en claro
    expect(sobre.startsWith("v1:")).toBe(true);
    expect(descifrarCredencial(sobre)).toBe(secreto);
  });

  it("dos cifrados del mismo texto difieren (IV aleatorio) pero descifran igual", () => {
    const a = cifrarCredencial("x");
    const b = cifrarCredencial("x");
    expect(a).not.toBe(b);
    expect(descifrarCredencial(a)).toBe("x");
    expect(descifrarCredencial(b)).toBe("x");
  });

  it("detecta manipulación (auth tag GCM)", () => {
    const sobre = cifrarCredencial("integridad");
    const partes = sobre.split(":");
    partes[3] = partes[3].replace(/.$/, (c) => (c === "0" ? "1" : "0")); // corrompe 1 char del ciphertext
    expect(() => descifrarCredencial(partes.join(":"))).toThrow();
  });

  it("rechaza formato inválido", () => {
    expect(() => descifrarCredencial("no-es-un-sobre")).toThrow();
  });
});

describe("mockActuacionesAdapter (determinista → base de la idempotencia)", () => {
  it("el mismo radicado devuelve SIEMPRE las mismas actuaciones", async () => {
    const r1 = await mockActuacionesAdapter.fetchActuaciones("1100131030012024001");
    const r2 = await mockActuacionesAdapter.fetchActuaciones("1100131030012024001");
    expect(r1).toEqual(r2);
    expect(r1.length).toBeGreaterThan(0);
    expect(r1[0]).toMatchObject({ actuacion: expect.any(String), fuente: expect.any(String) });
  });

  it("radicados distintos producen fechas distintas (no colisionan)", async () => {
    const a = await mockActuacionesAdapter.fetchActuaciones("AAAA0000000000000001");
    const b = await mockActuacionesAdapter.fetchActuaciones("ZZZZ9999999999999999");
    expect(a[0].fecha).not.toBe(b[0].fecha);
  });

  it("el modo es scrape (simula CPNU) y nunca toca la red", async () => {
    expect(mockActuacionesAdapter.mode).toBe("scrape");
    // fetchActuaciones es puro: no requiere stub de fetch
    await expect(mockActuacionesAdapter.fetchActuaciones("X")).resolves.toBeInstanceOf(Array);
  });
});
