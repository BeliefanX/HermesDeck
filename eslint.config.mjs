import next from 'eslint-config-next';

export default [
  ...next(),
  {
    rules: {
      'react/no-unescaped-entities': 'off',
      '@next/next/no-img-element': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'public/sw.js'],
  },
];
