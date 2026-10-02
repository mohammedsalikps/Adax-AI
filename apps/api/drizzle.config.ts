import { defineConfig } from 'drizzle-kit'

// drizzle-kit is used only to *generate* reviewed SQL migrations from
// src/db/schema.ts. They are applied by src/db/migrator.ts (transactional per
// file, checksummed); see README "Database".
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
})
