import { startTracing } from '@/tracing';

// Side-effect-only module: starting tracing here (rather than in tracing.ts)
// keeps the SDK from booting when tests import the pure helpers. main.ts imports
// this first so the SDK patches pg/amqplib/http before Nest requires them.
startTracing();
