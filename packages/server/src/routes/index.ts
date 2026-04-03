import { Router } from 'express';
import { createMiddleware } from './middleware.js';
import { createAuthRoutes } from './auth.js';
import { createUniverseRoutes } from './universe.js';
import { createAdminStatsRoutes } from './admin/stats.js';
import { createAdminLifecycleRoutes } from './admin/lifecycle.js';
import { createAdminPortRoutes } from './admin/ports.js';
import { createCatalogRoutes } from './catalog.js';
import type { RouteDeps } from './middleware.js';

export type { RouteDeps };

export function createRoutes(deps: RouteDeps): Router {
    const router = Router();
    const middleware = createMiddleware(deps);

    createAuthRoutes(router, deps, middleware);
    createUniverseRoutes(router, deps, middleware);
    createAdminStatsRoutes(router, deps, middleware);
    createAdminLifecycleRoutes(router, deps, middleware);
    createAdminPortRoutes(router, deps, middleware);
    createCatalogRoutes(router);

    return router;
}
