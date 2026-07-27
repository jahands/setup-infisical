// @ts-check
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/', 'coverage/']
  },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    // Config files are not part of the TypeScript project; lint them
    // without type information.
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked]
  }
)
