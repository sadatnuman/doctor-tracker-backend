import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

export const notFound: RequestHandler = (req) => {
  throw ApiError.notFound(`Route ${req.method} ${req.originalUrl}`);
};

interface ErrorBody {
  error: { code: string; message: string; details?: unknown; stack?: string };
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let status = 500;
  const body: ErrorBody = { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } };

  if (err instanceof ApiError) {
    status = err.statusCode;
    body.error = { code: err.code, message: err.message, details: err.details };
  } else if (err instanceof ZodError) {
    status = 400;
    body.error = {
      code: 'VALIDATION_ERROR',
      message: err.issues[0]?.message ?? 'Invalid request',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    };
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    body.error = {
      code: 'VALIDATION_ERROR',
      message: 'Invalid data',
      details: Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })),
    };
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    body.error = { code: 'BAD_REQUEST', message: `Invalid value for ${err.path}` };
  } else if (err?.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyValue ?? {})[0] ?? 'field';
    body.error = { code: 'CONFLICT', message: `A record with this ${field} already exists`, details: { field } };
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    body.error = { code: 'BAD_REQUEST', message: 'Malformed JSON body' };
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    body.error = { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
  }

  if (status >= 500) {
    console.error(err);
    if (!env.isProduction && err instanceof Error) body.error.stack = err.stack;
  }

  res.status(status).json(body);
};
