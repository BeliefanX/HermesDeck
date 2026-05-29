import nextConfig from 'eslint-config-next';

const eslintConfig = [
  ...nextConfig,
  {
    rules: {
      'react/no-unescaped-entities': 'off',
      'react/no-children-prop': 'off',
      '@next/next/no-img-element': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
    },
  },
  {
    ignores: ['.next/**', '.claude/**', 'node_modules/**', 'public/sw.js', 'docs/design-handoff/**', 'tsconfig.tsbuildinfo'],
  },
];

export default eslintConfig;
