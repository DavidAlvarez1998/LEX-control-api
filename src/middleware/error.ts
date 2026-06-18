import type { NextFunction, Request, Response } from "express";
import { isProd } from "../config/env";
import { mapPrismaError } from "../shared/errors";
import { logger } from "../shared/logger";

/** Error with an HTTP status. Handlers throw these; the error middleware maps them to JSON. */
export class HttpError extends Error {
  readonly status: number;
  readonly issues?: unknown;

  constructor(status: number, message: string, issues?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.issues = issues;
  }
}

/** 404 handler for unmatched routes. */
export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: { message: "Not Found" } });
}

/** Central error handler — produces the uniform { error: { message, issues? } } shape. */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Permite mapear errores conocidos de Prisma (P2002/P2025/P2003) que lleguen sin
  // manejar; el manejo explícito de un router ya viaja como HttpError y tiene prioridad.
  const mapped = err instanceof HttpError ? err : mapPrismaError(err);

  if (mapped instanceof HttpError) {
    res.status(mapped.status).json({
      error: {
        message: mapped.message,
        ...(mapped.issues !== undefined ? { issues: mapped.issues } : {}),
      },
    });
    return;
  }

  logger.error("unhandled_error", {
    reqId: req.id,
    method: req.method,
    path: req.path,
    err: !isProd ? err : undefined,
  });
  res.status(500).json({ error: { message: "Internal Server Error" } });
}
