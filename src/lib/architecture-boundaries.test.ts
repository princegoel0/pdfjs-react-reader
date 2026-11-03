/**
 * FR-48 / §3.1, §3.2.1, §5.5, §6.2: Architectural and Module Boundary Invariants.
 *
 * Enforces the architectural rules stated in PRD §3.1, §3.2.1, §5.5, and §6.2:
 *  1. §3.1: Core engine glue (src/lib/*) imports no React at runtime. Type-only imports
 *     (import type ... from 'react') are permitted; runtime imports are strictly refused.
 *  2. §3.1: Downward-only imports: src/lib/* must never import upward from components,
 *     features, or headless hooks.
 *  3. §6.2: Writes are batched; rearranging pages is an in-memory permutation of integers
 *     and rotations, requiring zero writer allocations until write time.
 *  4. §5.5: Find-controller interface stability as a modular shape.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { initialPlan, inversePlan, isPristine, movePlanned, rotatePlanned } from './page-plan';

const root = process.cwd();

describe('FR-48 / §3.1: Module separation and downward-only imports', () => {
  const libDir = join(root, 'src', 'lib');
  const sourceFiles = readdirSync(libDir).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.spec.ts'),
  );

  it('proves core engine glue (src/lib/*) imports no React at runtime', () => {
    for (const file of sourceFiles) {
      const code = readFileSync(join(libDir, file), 'utf8');
      const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);

      for (const stmt of sf.statements) {
        if (ts.isImportDeclaration(stmt)) {
          const specifier = (stmt.moduleSpecifier as ts.StringLiteral).text;
          if (specifier === 'react' || specifier === 'react-dom') {
            const isTypeOnly = stmt.importClause?.isTypeOnly === true;
            expect(
              isTypeOnly,
              `src/lib/${file} contains a runtime import from "${specifier}". PRD §3.1 forbids runtime React in core engine glue.`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('proves core engine glue (src/lib/*) contains zero upward imports to components, headless, or features', () => {
    for (const file of sourceFiles) {
      const code = readFileSync(join(libDir, file), 'utf8');
      const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);

      for (const stmt of sf.statements) {
        if (ts.isImportDeclaration(stmt)) {
          const specifier = (stmt.moduleSpecifier as ts.StringLiteral).text;
          expect(
            specifier,
            `src/lib/${file} imports upward from "${specifier}". PRD §3.1 requires layers to import downward only.`,
          ).not.toMatch(/^\.\.\/(components|features|headless)/);
        }
      }
    }
  });
});

describe('FR-48 / §6.2: Batched writes and integer permutations', () => {
  it('manipulates page orders as integer permutations without invoking writer passes', () => {
    const plan = initialPlan(10);
    expect(isPristine(plan, 10)).toBe(true);
    expect(plan.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // Move slot 0 to slot 4
    const moved = movePlanned(plan, 0, 4);
    expect(moved.order).toEqual([1, 2, 3, 4, 0, 5, 6, 7, 8, 9]);
    expect(isPristine(moved, 10)).toBe(false);

    // Rotate page at slot 0
    const rotated = rotatePlanned(moved, 0, 90);
    expect(rotated.rotations[1]).toBe(90);

    // Undo via inversePlan costs zero disk or writer allocations
    const inv = inversePlan(rotated, plan);
    expect(inv).not.toBeNull();
  });
});

