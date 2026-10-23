import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

type Schemas = { body?: ZodType; query?: ZodType; params?: ZodType };

/**
 * Validates and coerces request parts. Parsed values land on `req.validated`
 * (Express 5 makes `req.query` read-only). ZodErrors bubble to the error handler.
 */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    req.validated = {
      body: schemas.body ? schemas.body.parse(req.body ?? {}) : undefined,
      query: schemas.query ? schemas.query.parse(req.query) : undefined,
      params: schemas.params ? schemas.params.parse(req.params) : undefined,
    };
    next();
  };
