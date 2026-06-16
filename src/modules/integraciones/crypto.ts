// Cifrado simétrico de credenciales de proveedor (AES-256-GCM). La API key de un
// agregador/RUES NUNCA se guarda en texto plano (spec integraciones-estatales:
// "Credentials MUST be stored encrypted"). La llave se deriva de
// INTEGRACIONES_ENC_KEY si existe, o de JWT_SECRET (scrypt) como respaldo, para
// funcionar sin configurar un secreto extra. Formato: "v1:<iv>:<tag>:<ct>" (hex).
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { env } from "../../config/env";

const ALGO = "aes-256-gcm";
const VERSION = "v1";

// 32 bytes derivados de forma determinista (misma llave entre reinicios).
const KEY = scryptSync(env.integraciones.encKey, "lex-integraciones-cred", 32);

/** Cifra un texto. Devuelve un sobre "v1:iv:tag:ciphertext" en hex. */
export function cifrarCredencial(plano: string): string {
  const iv = randomBytes(12); // 96 bits, recomendado para GCM
  const cipher = createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(plano, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

/** Descifra un sobre producido por `cifrarCredencial`. Lanza si está corrupto o
 *  la llave cambió (autenticación GCM). */
export function descifrarCredencial(sobre: string): string {
  const partes = sobre.split(":");
  if (partes.length !== 4 || partes[0] !== VERSION) {
    throw new Error("Credencial cifrada con formato inválido");
  }
  const [, ivHex, tagHex, ctHex] = partes;
  const decipher = createDecipheriv(ALGO, KEY, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]).toString("utf8");
}
