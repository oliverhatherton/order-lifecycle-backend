import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { buildSpanExporter, createTracingSdk } from '@/tracing';

describe('tracing', () => {
  describe('buildSpanExporter', () => {
    it('uses the console exporter when no OTLP endpoint is configured', () => {
      expect(buildSpanExporter({})).toBeInstanceOf(ConsoleSpanExporter);
    });

    it('uses the OTLP exporter when an endpoint is configured', () => {
      const exporter = buildSpanExporter({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      });
      expect(exporter).toBeInstanceOf(OTLPTraceExporter);
    });
  });

  describe('createTracingSdk', () => {
    // Pass [] instrumentations so building the SDK patches nothing in the test.
    it('builds a NodeSDK', () => {
      expect(createTracingSdk([], {})).toBeInstanceOf(NodeSDK);
    });
  });
});
