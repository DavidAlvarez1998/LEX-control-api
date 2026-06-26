// fileFilter de multer (S0.2): lista NEGRA — bloquea ejecutables/scripts/HTML y
// acepta cualquier formato de documento legítimo (pdf/docx/odt/rtf/xlsx/imágenes).
import { describe, expect, it } from "vitest";
import { fileFilter } from "../src/middleware/upload";
import { HttpError } from "../src/middleware/error";

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
  it("acepta documentos legítimos (pdf, word, odt, rtf, excel, imágenes)", () => {
    expect(correr("demanda.pdf", "application/pdf").aceptado).toBe(true);
    expect(correr("poder.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document").aceptado).toBe(true);
    expect(correr("doc.odt", "application/vnd.oasis.opendocument.text").aceptado).toBe(true); // el caso que rompía
    expect(correr("carta.rtf", "application/rtf").aceptado).toBe(true);
    expect(correr("escaneo.JPG", "image/jpeg").aceptado).toBe(true);
  });

  it("acepta MIME genérico/vacío y archivos sin extensión (subidas reales)", () => {
    expect(correr("demanda.pdf", "application/octet-stream").aceptado).toBe(true);
    expect(correr("poder.pdf", "").aceptado).toBe(true);
    expect(correr("1781030558296_api_documento", "application/octet-stream").aceptado).toBe(true);
  });

  it("rechaza ejecutables, scripts y HTML/SVG con HttpError 400", () => {
    for (const [name, mime] of [
      ["evil.html", "text/html"], ["x.svg", "image/svg+xml"], ["m.exe", "application/octet-stream"],
      ["s.sh", "application/x-sh"], ["a.js", "text/javascript"],
    ] as const) {
      const { aceptado, error } = correr(name, mime);
      expect(aceptado).toBeUndefined();
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(400);
    }
  });

  it("rechaza por MIME peligroso aunque la extensión parezca inofensiva", () => {
    expect(correr("falso.pdf", "text/html").error).toBeInstanceOf(HttpError); // .pdf pero sirve HTML
    expect(correr("sin_ext", "image/svg+xml").error).toBeInstanceOf(HttpError);
  });
});
