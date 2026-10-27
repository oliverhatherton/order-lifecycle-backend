import { InitialSchema1782896581863 } from '@/database/migrations/1782896581863-InitialSchema';
import { AddMetricEventsAndPaymentInitiatedAt1782907200000 } from '@/database/migrations/1782907200000-AddMetricEventsAndPaymentInitiatedAt';
import { AddCartsProductsOrderItemsAndCancelled1782910000000 } from '@/database/migrations/1782910000000-AddCartsProductsOrderItemsAndCancelled';
import { AddOutboxMessages1782920000000 } from '@/database/migrations/1782920000000-AddOutboxMessages';
import { AddRefreshTokenFamily1782930000000 } from '@/database/migrations/1782930000000-AddRefreshTokenFamily';
import { PaymentAuthorizationClaim1782940000000 } from '@/database/migrations/1782940000000-PaymentAuthorizationClaim';
import { AddProductActive1782950000000 } from '@/database/migrations/1782950000000-AddProductActive';
import { OneOpenCartPerUser1782960000000 } from '@/database/migrations/1782960000000-OneOpenCartPerUser';

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
  AddOutboxMessages1782920000000,
  AddRefreshTokenFamily1782930000000,
  PaymentAuthorizationClaim1782940000000,
  AddProductActive1782950000000,
  OneOpenCartPerUser1782960000000,
];
