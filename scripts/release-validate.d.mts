/**
 * Type declarations for `scripts/release-validate.mjs`, written by hand in the same shape as
 * `scripts/benchmark-baseline.d.mts` — the gate is plain JavaScript so the workflow can run it without a build,
 * and the test that refuses it on purpose is typed.
 */

export interface CandidateLeg {
  leg: string;
  conclusion: string;
}

export interface CandidateRecord {
  file?: string;
  tag?: string;
  commit?: string;
  artifact?: { file?: string; sha256?: string };
  legs?: CandidateLeg[];
  passes?: boolean;
  notPassed?: string[];
}

export interface CiJob {
  name: string;
  status: string;
  conclusion: string;
}

export interface Packument {
  versions?: Record<string, unknown>;
  'dist-tags'?: { latest?: string };
}

export interface RequiredJobRule {
  prefix: string;
  label: string;
  matrix: string;
  atLeast: number;
}

export const REQUIRED_JOBS: RequiredJobRule[];

export function deriveCandidatePasses(legs: CandidateLeg[]): { passes: boolean; notPassed: string[] };

export function requiredLegsFrom(rcRecordSource: string): string[];

export function ciProblems(jobs: CiJob[], sha: string): string[];

export function candidateProblems(records: CandidateRecord[], options: { version: string; sha: string }): string[];

export function registryProblems(packument: Packument | null, name: string, version: string): string[];

export function tagProblems(described: string, version: string): string[];

export interface ReleaseValidateDeps {
  headSha(): string;
  tagOfHead(): string;
  jobs(sha: string): Promise<CiJob[]>;
  packument(name: string): Promise<Packument | null>;
  records(): CandidateRecord[];
}

export function realDeps(): ReleaseValidateDeps;

export function main(deps: ReleaseValidateDeps, argv?: string[]): Promise<number>;
