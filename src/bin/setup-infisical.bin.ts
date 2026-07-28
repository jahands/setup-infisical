import { run } from '../main.js'

// Entrypoint shim so main.ts stays importable (and mockable) in tests.
void run()
