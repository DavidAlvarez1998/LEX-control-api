import type { NextFunction, Request, Response } from "express";

/**
 * Wraps an async route handler so any rejected promise is forwarded to the
 * Express error middleware. Express 4 does not await handlers, so without this
 * a thrown error inside an async handler would never reach errorHandler.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
