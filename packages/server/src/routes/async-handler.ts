import type { Request, Response, NextFunction, RequestHandler } from 'express';

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
