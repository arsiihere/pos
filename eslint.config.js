import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

const forbiddenCalls = [
  {
    selector: 'CallExpression[callee.object.name="Date"][callee.property.name="now"]',
    message: 'Date.now is forbidden; take a Clock (F §6.7).',
  },
  {
    selector: 'CallExpression[callee.object.name="performance"][callee.property.name="now"]',
    message: 'performance.now is forbidden; take a Clock (F §6.7).',
  },
  {
    selector: 'CallExpression[callee.object.name="Math"][callee.property.name="random"]',
    message: 'Math.random is forbidden; take an IdGen (F §6.7).',
  },
  {
    selector: 'CallExpression[callee.property.name="randomUUID"]',
    message: 'crypto.randomUUID is forbidden; take a SecretGen (F §6.7).',
  },
  {
    selector: 'CallExpression[callee.name="randomUUID"]',
    message: 'randomUUID is forbidden; take a SecretGen (F §6.7).',
  },
  {
    selector: 'CallExpression[callee.name="ulid"]',
    message: 'ulid is forbidden; take an IdGen (F §6.7).',
  },
];

const dbClientImports = {
  patterns: [
    {
      group: ['**/db/client', '**/db/client.js'],
      message: 'Import the database client only from apps/cloud/src/db/ (D54).',
    },
  ],
};

const systemContextImports = {
  patterns: [
    {
      group: ['**/cli/system-context', '**/cli/system-context.js'],
      message: 'Import SystemContext only from apps/cloud/src/cli/ (M56).',
    },
  ],
};

const credentialLookupImports = {
  patterns: [
    {
      group: ['**/db/credential-lookup', '**/db/credential-lookup.js'],
      message:
        'Import credential-lookup only from plugins/tenant-scope.ts and plugins/owner-credentials.ts (M55).',
    },
  ],
};

const qrcodeImports = {
  patterns: [
    {
      group: ['qrcode', 'qrcode/*', 'qrcode/**'],
      message:
        'Import qrcode only from apps/hub/src/setup/issue-admin-bootstrap.ts and apps/hub/src/lib/qr.ts (M72, M77).',
    },
  ],
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.turbo/**', '**/coverage/**'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...dbClientImports.patterns,
            ...qrcodeImports.patterns,
            ...credentialLookupImports.patterns,
            ...systemContextImports.patterns,
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...forbiddenCalls],
    },
  },
  {
    files: [
      'apps/*/src/lib/clock.ts',
      'apps/*/src/lib/ids.ts',
      'apps/*/src/lib/secrets.ts',
      'apps/*/src/main.ts',
      'apps/cloud/src/cli/*.ts',
      'apps/hub/src/setup/issue-admin-bootstrap.ts',
      'apps/hub/test/smoke/smoke.ts',
      '**/*.test.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['apps/cloud/src/db/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...qrcodeImports.patterns, ...credentialLookupImports.patterns, ...systemContextImports.patterns] },
      ],
    },
  },
  {
    files: ['apps/hub/src/setup/issue-admin-bootstrap.ts', 'apps/hub/src/lib/qr.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [...dbClientImports.patterns, ...credentialLookupImports.patterns, ...systemContextImports.patterns],
        },
      ],
    },
  },
  {
    files: ['apps/cloud/src/plugins/tenant-scope.ts', 'apps/cloud/src/plugins/owner-credentials.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...dbClientImports.patterns, ...qrcodeImports.patterns, ...systemContextImports.patterns] },
      ],
    },
  },
  {
    files: ['apps/cloud/src/cli/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...dbClientImports.patterns, ...qrcodeImports.patterns, ...credentialLookupImports.patterns] },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...dbClientImports.patterns, ...qrcodeImports.patterns] }],
    },
  },
);
