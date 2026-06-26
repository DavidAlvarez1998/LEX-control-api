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
const MIME_PERMITIDOS = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg", "image/png", "image/webp", "image/tiff",
]);

const MAX_BYTES = 15 * 1024 * 1024;

/** Lista blanca: acepta solo si la extensión Y el MIME están permitidos. Rechaza con un
 *  HttpError(400) (lo renderiza el errorHandler) en vez de aceptar binarios arbitrarios. */
export const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (EXT_PERMITIDAS.has(ext) && MIME_PERMITIDOS.has(file.mimetype)) {
    cb(null, true);
    return;
  }
  cb(new HttpError(400, `Tipo de archivo no permitido (${file.mimetype || ext || "desconocido"}). Solo PDF, Word/Excel o imágenes.`));
};

/** multer configurado: memoria + tope 15 MB + lista blanca de tipo (PDF/Office/imagen). */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter,
});
