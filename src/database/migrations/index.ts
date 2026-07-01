import { InitialSchema1782896581863 } from '@/database/migrations/1782896581863-InitialSchema';
import { AddMetricEventsAndPaymentInitiatedAt1782907200000 } from '@/database/migrations/1782907200000-AddMetricEventsAndPaymentInitiatedAt';
import { AddCartsProductsOrderItemsAndCancelled1782910000000 } from '@/database/migrations/1782910000000-AddCartsProductsOrderItemsAndCancelled';

/**
 * Explicit list of migrations for the running app. Referenced by class (not a
 * glob) so the webpack build bundles them — a `dist/**` glob wouldn't resolve.
 * The TypeORM CLI uses its own glob in data-source.ts. Append new migrations
 * here as they are generated.
 */
export const migrations = [
  InitialSchema1782896581863,
  AddMetricEventsAndPaymentInitiatedAt1782907200000,
  AddCartsProductsOrderItemsAndCancelled1782910000000,
];
