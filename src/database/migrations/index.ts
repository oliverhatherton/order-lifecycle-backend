import { InitialSchema1782896581863 } from '@/database/migrations/1782896581863-InitialSchema';

/**
 * Explicit list of migrations for the running app. Referenced by class (not a
 * glob) so the webpack build bundles them — a `dist/**` glob wouldn't resolve.
 * The TypeORM CLI uses its own glob in data-source.ts. Append new migrations
 * here as they are generated.
 */
export const migrations = [InitialSchema1782896581863];
