import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.aws-sam/**',
      '**/test-fixtures/**',
      'examples/**',
    ],
  },
  ...tseslint.configs.recommended,
)
