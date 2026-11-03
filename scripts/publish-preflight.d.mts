/**
 * Types for `scripts/publish-preflight.mjs`, in the shape `scripts/benchmark-baseline.d.mts` uses: the script is
 * plain JavaScript so the release path never needs a build, and the test that breaks its refusals is typed.
 */

export interface PreflightState {
  version: string;
  name: string;
  whoami: string;
  packument: { versions?: Record<string, unknown> } | null;
  tagName: string;
  taggedSha: string;
  headSha: string;
  changed: string[] | null;
  dirty: string;
  dryRunOk: boolean;
}

export interface ReadbackState {
  version: string;
  name: string;
  packument: { versions?: Record<string, unknown>; 'dist-tags'?: { latest?: string } } | null;
  downloaded: boolean;
  latestTag?: string;
  digest: string;
  bound: string | null;
}

export interface CandidateRecordLike {
  tag?: string;
  commit?: string;
  artifact?: { file?: string; sha256?: string };
  legs?: { leg: string; conclusion: string }[];
}

export function expectedDigest(records: CandidateRecordLike[]): string | null;

export function preflightProblems(state: PreflightState): string[];

export function readbackProblems(state: ReadbackState): string[];

export function run(mode: 'preflight' | 'readback'): Promise<number>;
