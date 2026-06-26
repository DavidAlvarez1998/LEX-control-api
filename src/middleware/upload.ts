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
 * Gate por EXTENSIÓN (la señal confiable): acepta las extensiones de la lista blanca y
 * rechaza el resto (html/svg/exe…). NO exige que el MIME esté en una lista blanca —los
 * navegadores/OS reportan MIME genérico (`application/octet-stream`) o vacío para PDFs/
 * Office legítimos, y exigirlo rompía subidas válidas— pero SÍ rechaza un MIME
 * claramente peligroso aunque la extensión sea válida. Rechaza con HttpError(400).
 */
export const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (EXT_PERMITIDAS.has(ext) && !MIME_PELIGROSOS.has(file.mimetype)) {
    cb(null, true);
    return;
  }
  cb(new HttpError(400, `Tipo de archivo no permitido (${ext || file.mimetype || "desconocido"}). Solo PDF, Word/Excel o imágenes.`));
};

/** multer configurado: memoria + tope 15 MB + lista blanca de tipo (PDF/Office/imagen). */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter,
});
