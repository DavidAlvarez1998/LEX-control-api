import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodSchema } from "zod";
import { HttpError } from "./error";

type Schemas = {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
};

/**
 * Validates request parts against zod schemas. On the first failure it forwards
 * a 400 HttpError carrying the zod issues; the error middleware renders them.
 */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.params) schemas.params.parse(req.params);
      if (schemas.query) schemas.query.parse(req.query);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(new HttpError(400, "Validation failed", err.issues));
        return;
      }
      next(err);
    }
  };
}
