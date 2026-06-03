import type { NextFunction, Request, Response } from "express";
import { isProd } from "../config/env";

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
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: {
        message: err.message,
        ...(err.issues !== undefined ? { issues: err.issues } : {}),
      },
    });
    return;
  }

  if (!isProd) {
    console.error(err);
  }
  res.status(500).json({ error: { message: "Internal Server Error" } });
}
