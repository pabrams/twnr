import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { z } from 'zod';

/** Thrown inside an async route handler to produce a specific HTTP response. */
export class HttpError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
        this.name = 'HttpError';
    }
}

/** Parse a numeric route/query param; throw HttpError(400) on NaN. */
export function parseIntParam(val: unknown, name: string): number {
    const n = parseInt(typeof val === 'string' ? val : '', 10);
    if (isNaN(n)) throw new HttpError(400, `${name} must be a number`);
    return n;
}

/**
 * Validate `req.body` against a zod schema. Returns the parsed value on
 * success; throws HttpError(400) with the first issue path + message on
 * failure. Keeps the handler body terse and consistent with structured
 * 400s across the API.
 */
export function parseBody<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
    const result = schema.safeParse(req.body);
    if (!result.success) {
        const first = result.error.issues[0];
        const where = first?.path.join('.') || '<root>';
        throw new HttpError(400, `${where}: ${first?.message}`);
    }
    return result.data;
}

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Wraps an async route handler so thrown errors reach the Express error middleware. */
export function asyncHandler(fn: AsyncRouteHandler): RequestHandler {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/** Express error middleware — registered once at the end of the route stack. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
    if (res.headersSent) return;
    if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
    }
    console.error(`${req.method} ${req.path}`, err);
    res.status(500).json({ error: 'Internal server error' });
}
