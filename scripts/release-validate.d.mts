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

/** Which class declined which leg, and which record on the same commit ran it instead. */
export function candidateNotes(records: CandidateRecord[], options: { version: string; sha: string }): string[];

export function registryProblems(packument: Packument | null, name: string, version: string): string[];

export interface ReleaseOrder {
  tagName: string;
  taggedSha: string;
  headSha: string;
  /** `null` when git could not name the range at all, which is a refusal rather than an empty diff. */
  changed: string[] | null;
}

/** What the tag and the tree have to say to each other before a publish may go ahead. */
export function releaseOrderProblems(order: ReleaseOrder): string[];

/** The only paths a commit after the tag may touch. */
export const RELEASE_EVIDENCE: RegExp;

export interface ReleaseValidateDeps {
  headSha(): string;
  tagCommit(tagName: string): string;
  changedBetween(from: string, to: string): string[] | null;
  jobs(sha: string): Promise<CiJob[]>;
  packument(name: string): Promise<Packument | null>;
  records(): CandidateRecord[];
}

export function realDeps(): ReleaseValidateDeps;

export function main(deps: ReleaseValidateDeps, argv?: string[]): Promise<number>;
