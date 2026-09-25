import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /* Two projects, because only the feature-seam tests touch the DOM and the
       library's own logic is tested in Node, where a jsdom global could hide an
       assumption about `window`. The DOM project needs `globals: true`: that is
       how @testing-library/react finds an `afterEach` to register its cleanup. */
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'jsdom',
          globals: true,
          include: ['src/**/*.test.tsx'],
        },
      },
    ],
  },
});
