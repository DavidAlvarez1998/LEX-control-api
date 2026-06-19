// Logger estructurado mínimo SIN dependencias nuevas (JSON por línea). Sustituible
// por pino más adelante sin cambiar el call-site. + middleware de request-id.
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { isProd } from "../config/env";
import { getContext, runWithContext } from "./request-context";
import { registrarHttp } from "./metrics";

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, meta?: Record<string, unknown>): void {
  // En test no ensuciamos la salida salvo errores.
  if (process.env.NODE_ENV === "test" && level !== "error") return;
  // El reqId del contexto activo se añade automáticamente (sin pasar `req`).
  const ctx = getContext();
  const line = { t: new Date().toISOString(), level, ...(ctx ? { reqId: ctx.reqId } : {}), msg, ...(meta ?? {}) };
  const out = level === "error" || level === "warn" ? console.error : console.log;
  out(isProd ? JSON.stringify(line) : `[${level}] ${msg}`, isProd ? "" : (meta ?? ""));
}

export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) => emit("debug", m, meta),
  info: (m: string, meta?: Record<string, unknown>) => emit("info", m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => emit("warn", m, meta),
  error: (m: string, meta?: Record<string, unknown>) => emit("error", m, meta),
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

/** Asigna un request-id (cabecera X-Request-Id o uno nuevo), abre el contexto de
 *  request (AsyncLocalStorage) para correlación y registra un access-log al cerrar. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers["x-request-id"] as string) || randomUUID();
  req.id = id;
  res.setHeader("X-Request-Id", id);
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    emit(level, "http_request", { method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(durationMs) });
    // Ruta en bucket grueso (1er segmento) para no explotar la cardinalidad con IDs.
    const route = "/" + (req.path.split("/")[1] ?? "");
    registrarHttp(req.method, route, res.statusCode, durationMs);
  });
  runWithContext({ reqId: id, method: req.method, path: req.path }, next);
}
