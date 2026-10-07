/**
 * The declaration for `scripts/benchmark-baseline.mjs`, so `src/lib/benchmark-baseline.test.ts` can run the
 * gate's arithmetic against numbers it makes up — which is the only way to falsify a regression gate without
 * waiting for a machine to actually get slower. Same reason `scripts/axe-tags.d.mts` exists.
 */

export interface BenchmarkEnvironment {
  machine: string;
  arch: string;
  platform: string;
  osRelease: string;
  memoryGb: number;
  node: string;
  browser: string;
  engine: string;
  revision: string;
  ranAt: string;
}

export interface Distribution {
  samples: number;
  p50: number;
  p95: number;
  p99: number | null;
  max: number;
}

export interface Fixture {
  name: string;
  bytes: number;
  sha256: string;
}

export interface Measure {
  label: string;
  detail: string;
  distribution: Distribution | null;
}

export interface ProfileRecord {
  id: string;
  name: string;
  target: string;
  fixture: Fixture | null;
  bars: Array<{ label: string; ok: boolean; detail: string }>;
  measures: Measure[];
  notes: Array<{ label: string; detail: string }>;
}

export interface BenchmarkRunRecord {
  schema: number;
  environment: BenchmarkEnvironment;
  caps: Record<string, number>;
  profiles: ProfileRecord[];
}

export interface Reading {
  p50: number;
  p95: number;
  max: number;
  samples: number;
  at: string;
  revision: string;
  browser: string;
  osRelease: string;
}

export interface Entry {
  fixture: Fixture | null;
  readings: Reading[];
  reference: number | null;
  tolerance: number | null;
  status: 'live' | 'blind' | 'provisional';
}

export interface Baseline {
  schema: number;
  about: string;
  rule: string;
  gate: Gate;
  spreadEvidence: string;
  environments: Record<string, { describe: string; environment?: Partial<BenchmarkEnvironment>; entries: Record<string, Entry> }>;
}

export interface Gate {
  safetyMargin: number;
  toleranceFloor: number;
  toleranceCeiling: number;
  minimumReadings: number;
  minimumSamples: number;
  maximumReadings: number;
}

export declare const GATE: Gate;

export type EntryState =
  | {
      live: true;
      blind: false;
      provisional: false;
      readings: number;
      spread: number;
      reference: number;
      referenceP95: number;
      tolerance: number;
      floored: boolean;
    }
  | { live: false; blind: true; provisional: false; readings: number; spread: number; reason: string }
  | { live: false; provisional: true; blind: false; readings: number; reason: string };

export interface GateLine {
  label: string;
  status: 'pass' | 'fail' | 'na' | 'blind';
  detail: string;
}

export declare function fingerprint(environment: BenchmarkEnvironment): string;

export declare function entryState(entry: Entry | undefined): EntryState;

export declare function compareRun(args: {
  baseline: Baseline;
  environment: BenchmarkEnvironment;
  profiles: ProfileRecord[];
}): { key: string; lines: GateLine[] };

export declare function summarise(lines: GateLine[]): {
  compared: number;
  failed: number;
  na: number;
  blind: number;
  total: number;
  text: string;
};

export declare function mergeRecord(args: {
  baseline: Baseline;
  record: BenchmarkRunRecord;
  force?: boolean;
}): {
  baseline: Baseline;
  key: string;
  added: Array<{ label: string; state: EntryState; readings: number }>;
  refused: Array<{ label: string; why: string }>;
  skipped: Array<{ label: string; why: string }>;
};

export declare function BASELINE_HEADER(): Baseline;
