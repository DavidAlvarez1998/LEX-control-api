// Subida de archivos (multer) compartida y endurecida. Single source para los uploads
// de procesos y contratos: memoria (el binario va a un microservicio externo, no a
// disco), tope de tamaño y un `fileFilter` por LISTA NEGRA.
//
// Por qué denylist y no whitelist: un gestor documental recibe formatos MUY diversos
// (pdf, docx, odt, rtf, xlsx, imágenes, escaneos, comprobantes…). Una lista blanca de
// extensiones se queda corta y rompe subidas legítimas (nos pasó con MIME genérico,
// con archivos sin extensión y con .odt). El riesgo real es subir EJECUTABLES/SCRIPTS/
// HTML que el documental pudiera servir inline (XSS almacenado), así que se bloquea
// SOLO eso (por extensión y por MIME) y se acepta el resto.
import multer from "multer";
import path from "node:path";
import { HttpError } from "./error";

// Extensiones peligrosas: ejecutables, scripts y markup que se interpreta en el navegador.
const EXT_PELIGROSAS = new Set([
  ".exe", ".com", ".bat", ".cmd", ".msi", ".scr", ".pif", ".cpl", ".dll", ".jar",
  ".sh", ".bash", ".zsh", ".ps1", ".psm1", ".vbs", ".vbe", ".wsf", ".wsh", ".hta",
  ".js", ".mjs", ".cjs", ".jse", ".php", ".phtml", ".jsp", ".asp", ".aspx", ".cgi", ".pl",
  ".html", ".htm", ".xhtml", ".shtml", ".svg", ".xml",
]);
// MIME peligrosos: aunque la extensión parezca inofensiva, se rechaza si el navegador
// reporta un tipo que se serviría/ejecutaría como markup o binario ejecutable.
const MIME_PELIGROSOS = new Set([
  "text/html", "application/xhtml+xml", "image/svg+xml", "application/xml", "text/xml",
  "application/javascript", "text/javascript", "application/x-javascript",
  "application/x-msdownload", "application/x-msdos-program", "application/x-sh",
  "application/x-httpd-php", "application/x-executable",
]);

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Lista negra: rechaza solo extensiones/MIME claramente peligrosos (ejecutables, scripts,
 * HTML/SVG/XML) y acepta todo lo demás (pdf, docx, odt, rtf, xlsx, imágenes, escaneos…).
 * Rechaza con HttpError(400), que el errorHandler renderiza como 400.
 */
export const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (EXT_PELIGROSAS.has(ext) || MIME_PELIGROSOS.has(file.mimetype)) {
    cb(new HttpError(400, `Tipo de archivo no permitido (${ext || file.mimetype || "desconocido"}). No se admiten ejecutables ni páginas web.`));
    return;
  }
  cb(null, true);
};

/** multer configurado: memoria + tope 15 MB + filtro por lista negra. */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter,
});
