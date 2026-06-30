import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  ConsoleSpanExporter,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/** The instrumentation list shape, without depending on the transitive package. */
type Instrumentations = ReturnType<typeof getNodeAutoInstrumentations>;

/**
 * OpenTelemetry tracing for the order lifecycle. Auto-instruments HTTP, the
 * `pg` driver and `amqplib`, so one trace follows a request through the DB and
 * across the RabbitMQ boundary (the amqplib instrumentation injects/extracts
 * W3C trace context on message headers automatically). Must start before Nest
 * and its deps are required — `tracing.bootstrap.ts` calls `startTracing()` and
 * is the first import in `main.ts`. This module is side-effect-free so its pure
 * helpers can be unit-tested without starting the SDK.
 */

/** OTLP exporter when an endpoint is configured, else the console exporter. */
export function buildSpanExporter(
  env: NodeJS.ProcessEnv = process.env,
): SpanExporter {
  return env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? new OTLPTraceExporter()
    : new ConsoleSpanExporter();
}

/** Builds (does not start) the tracing SDK. Instrumentations are injectable for tests. */
export function createTracingSdk(
  instrumentations: Instrumentations = getNodeAutoInstrumentations(),
  env: NodeJS.ProcessEnv = process.env,
): NodeSDK {
  return new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME ?? 'order-lifecycle-backend',
    }),
    traceExporter: buildSpanExporter(env),
    instrumentations,
  });
}

let sdk: NodeSDK | undefined;

/** Starts tracing once; a no-op if already started. Called by tracing.bootstrap. */
export function startTracing(): void {
  if (sdk) return;
  sdk = createTracingSdk();
  sdk.start();
}
