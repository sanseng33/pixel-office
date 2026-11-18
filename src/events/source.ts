export type OfficeEventType = 'dealClosed' | 'deploySuccess' | 'visitorArrived';

export interface OfficeEvent {
  type: OfficeEventType;
  /** 1-based floor level the celebration belongs to. */
  level: number;
  ttlMs: number;
  /** performance.now() when the source emitted the event. */
  at: number;
}

/**
 * Swap this for a WebSocket or HTTP feed later.
 * `start` may call `onEvent` on a timer; it must not throw.
 * `stop` cancels any pending work.
 */
export interface EventSource {
  start(onEvent: (event: OfficeEvent) => void): void;
  stop(): void;
}

export interface MockSourceOptions {
  minMs?: number;
  maxMs?: number;
  ttlMs?: number;
  random?: () => number;
  /** Which levels currently accept each event. Read live so floor edits apply. */
  levelsFor?: (type: OfficeEventType) => readonly number[];
  /** First delay. Defaults to the same 10–30s window. */
  firstMs?: number;
}

const TYPES: readonly OfficeEventType[] = ['dealClosed', 'deploySuccess', 'visitorArrived'];

/**
 * Fake polling loop. Every 10–30s (configurable) it emits one event whose
 * floor is chosen from the current floor config.
 */
export function createMockEventSource(options: MockSourceOptions = {}): EventSource {
  const minMs = options.minMs ?? 10_000;
  const maxMs = options.maxMs ?? 30_000;
  const ttlMs = options.ttlMs ?? 5_500;
  const random = options.random ?? Math.random;
  const levelsFor = options.levelsFor ?? (() => []);
  let timer = 0;
  let stopped = true;

  function pick(type: OfficeEventType): number {
    const levels = levelsFor(type);
    if (!levels.length) return 0;
    return levels[(random() * levels.length) | 0] ?? 0;
  }

  return {
    start(onEvent) {
      stopped = false;
      const arm = (delay: number) => {
        timer = window.setTimeout(() => {
          if (stopped) return;
          let type = TYPES[(random() * TYPES.length) | 0] ?? 'dealClosed';
          let level = pick(type);
          for (let i = 0; i < TYPES.length && !level; i++) {
            type = TYPES[i] ?? type;
            level = pick(type);
          }
          if (level) {
            onEvent({ type, level, ttlMs, at: performance.now() });
          }
          const span = Math.max(0, maxMs - minMs);
          arm(minMs + random() * span);
        }, delay);
      };
      const first = options.firstMs ?? minMs + random() * Math.max(0, maxMs - minMs);
      arm(first);
    },
    stop() {
      stopped = true;
      window.clearTimeout(timer);
    },
  };
}
