// Subida de archivos (multer) compartida y endurecida. Single source para los uploads
// de procesos y contratos: memoria (el binario va a un microservicio externo, no a
// disco), tope de tamaño y un `fileFilter` con lista blanca de tipo/extensión para que
// un usuario autenticado no pueda subir HTML/SVG/ejecutables (riesgo de XSS almacenado
// si el documental los sirviera inline).
import multer from "multer";
import path from "node:path";
import { HttpError } from "./error";

const EXT_PERMITIDAS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff",
]);
// MIME claramente peligrosos: se rechazan aunque la extensión sea válida (un .pdf que
// en realidad es HTML/SVG y se serviría inline = XSS almacenado).
const MIME_PELIGROSOS = new Set([
  "text/html", "application/xhtml+xml", "image/svg+xml",
  "application/x-msdownload", "application/javascript", "text/javascript",
]);

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Filtro de subida. Reglas (en orden):
 *  1. MIME claramente peligroso (html/svg/js/exe) → SIEMPRE rechaza, aunque la ext parezca ok.
 *  2. Extensión en la lista blanca (.pdf/.docx/imágenes…) → acepta.
 *  3. SIN extensión → acepta (muchos docs generados/descargados llegan sin extensión,
 *     p. ej. los `..._api_documento`; el MIME peligroso ya se filtró en el paso 1).
 *  4. Extensión presente pero NO permitida (.exe, .bat, .html…) → rechaza.
 * No se exige MIME en lista blanca: navegadores/OS reportan `application/octet-stream`
 * o vacío para PDFs/Office legítimos, y exigirlo rompía subidas válidas.
 */
export const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (MIME_PELIGROSOS.has(file.mimetype)) {
    cb(new HttpError(400, `Tipo de archivo no permitido (${file.mimetype}).`));
    return;
  }
  if (ext === "" || EXT_PERMITIDAS.has(ext)) {
    cb(null, true);
    return;
  }
  cb(new HttpError(400, `Tipo de archivo no permitido (${ext}). Solo PDF, Word/Excel o imágenes.`));
};

/** multer configurado: memoria + tope 15 MB + lista blanca de tipo (PDF/Office/imagen). */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter,
});
