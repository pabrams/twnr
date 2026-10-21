import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { z } from 'zod';

export class HttpError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
        this.name = 'HttpError';
    }
}

export function parseIntParam(val: unknown, name: string): number {
    const n = parseInt(typeof val === 'string' ? val : '', 10);
    if (isNaN(n)) throw new HttpError(400, `${name} must be a number`);
    return n;
}

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

export function asyncHandler(fn: AsyncRouteHandler): RequestHandler {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

// the unused 4th param is load-bearing: Express recognizes error middleware by 4-arg arity
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
    if (res.headersSent) return;
    if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
    }
    console.error(`${req.method} ${req.path}`, err);
    res.status(500).json({ error: 'Internal server error' });
}
