// fileFilter de multer (S0.2): lista blanca de tipo/extensión para los uploads.
import { describe, expect, it } from "vitest";
import { fileFilter } from "../src/middleware/upload";
import { HttpError } from "../src/middleware/error";

// Llama al fileFilter y captura el resultado del callback (cb(err) | cb(null, ok)).
function correr(originalname: string, mimetype: string) {
  let aceptado: boolean | undefined;
  let error: unknown;
  fileFilter!({} as never, { originalname, mimetype } as never, ((err: unknown, ok?: boolean) => {
    error = err;
    aceptado = ok;
  }) as never);
  return { aceptado, error };
}

describe("fileFilter de uploads", () => {
  it("acepta PDF, Word e imágenes", () => {
    expect(correr("demanda.pdf", "application/pdf").aceptado).toBe(true);
    expect(correr("poder.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document").aceptado).toBe(true);
    expect(correr("escaneo.JPG", "image/jpeg").aceptado).toBe(true); // extensión case-insensitive
  });

  it("rechaza HTML/SVG/ejecutables con HttpError 400", () => {
    for (const [name, mime] of [["evil.html", "text/html"], ["x.svg", "image/svg+xml"], ["m.exe", "application/octet-stream"]] as const) {
      const { aceptado, error } = correr(name, mime);
      expect(aceptado).toBeUndefined();
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(400);
    }
  });

  it("rechaza si la extensión es válida pero el MIME no (o viceversa)", () => {
    expect(correr("falso.pdf", "text/html").error).toBeInstanceOf(HttpError); // ext ok, mime no
    expect(correr("falso.html", "application/pdf").error).toBeInstanceOf(HttpError); // mime ok, ext no
  });
});
