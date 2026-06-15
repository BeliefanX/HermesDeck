import nextConfig from 'eslint-config-next';

const customRules = {
  'react/no-unescaped-entities': 'off',
  'react/no-children-prop': 'off',
  '@next/next/no-img-element': 'warn',
  'react-hooks/exhaustive-deps': 'warn',
  'react-hooks/set-state-in-effect': 'off',
  'react-hooks/refs': 'off',
  'react-hooks/immutability': 'off',
};

const eslintConfig = [
  {
    ...nextConfig[0],
    rules: {
      ...nextConfig[0].rules,
      ...customRules,
    },
  },
  ...nextConfig.slice(1),
  {
    ignores: ['.next/**', '.claude/**', 'node_modules/**', 'public/sw.js', 'docs/design-handoff/**', 'tsconfig.tsbuildinfo'],
  },
];

export default eslintConfig;
