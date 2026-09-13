---
name: migration-generator
description: Scaffold new golang-migrate migration files from a table/column description. Generates properly numbered up/down SQL with indexes, foreign keys, and timestamps.
---

# Migration Generator

Automates creation of new golang-migrate migration files with smart schema scaffolding.

## Invocation

Ask the user to describe the migration. Accept any natural language format, but parse:

```
<name>:<column1:type1,column2:type2,...>
```

- `<name>` — kebab-case table or index name (e.g. `repos`, `user_repo_mapping`)
- `:` — optional, if omitted it's a non-table migration (add raw SQL)
- `<column1:type1>` — column name and type, comma-separated
- Types: `text`, `bool`, `int`, `bigint`, `float`, `jsonb`, `uuid`, `timestamptz`, `serial`
- `references:<table>:<column>` after type for foreign keys (e.g. `user_id:bigint:references:users.id`)
- `unique` after type for UNIQUE constraints (e.g. `name:text:unique`)
- `not_null` after type (defaults to not null)
- `default:<value>` after type (e.g. `name:text:not_null:default:''`)

## Steps

### 1. Determine next sequence number

Read `src/api/database/migrations/`, list all `.up.sql` files, extract the leading number pattern `NNNNNN_`, parse the highest number, increment by 1.

If no migrations exist yet, start with `000001`.

Format: 6-digit zero-padded number.

### 2. Parse the description

Split on first `:` to separate `<name>` from column definitions.

Parse each column definition:
- `column_name:type:modifiers...`
- Type defaults to `text` if omitted
- Track foreign keys, unique constraints, default values

Classify the migration:
- **Table migration** — has column definitions after `:`
- **Index migration** — name contains `idx_` or `index`
- **Raw migration** — no `:` at all

### 3. Generate SQL

#### Table migration

```sql
CREATE TABLE IF NOT EXISTS <table_name> (
    id BIGSERIAL PRIMARY KEY,
    <column_definitions>,
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

<indexes>
```

Table naming: pluralize the name. If the name already looks plural (ends in `s`), use as-is. Otherwise append `s`.

Columns format: `  <name> <TYPE> [constraints]`

Column type maps:
- `text` → `TEXT`
- `bool` → `BOOLEAN`
- `int` → `INTEGER`
- `bigint` → `BIGINT`
- `float` → `DOUBLE PRECISION`
- `jsonb` → `JSONB`
- `uuid` → `UUID`
- `timestamptz` → `TIMESTAMPTZ`
- `serial` → `SERIAL`

Constraints on columns (in order):
- `NOT NULL` if specified or default (omit for timestamptz which has defaults)
- `UNIQUE` if `unique` modifier
- `REFERENCES <table>(<column>)` if `references` modifier
- `DEFAULT <value>` if `default` modifier
- For foreign key columns, make them `NOT NULL` by default

Timestamp columns:
- If column name is `created_at` or `linked_at` or `started_at` — `timestamptz DEFAULT NOW()`
- If column name is `updated_at` — `timestamptz DEFAULT NOW()`
- If column name is `deleted_at` — `timestamptz NULL` (allows soft delete check)
- Otherwise use the specified type

Unique constraints:
- Single column `UNIQUE` is inline on the column
- Composite unique (e.g. two columns both marked `unique` or explicit `unique(name, provider)`) goes as table-level constraint

Foreign keys: add `ON DELETE CASCADE` by default unless `on_delete:no_cascade` is specified.

Auto columns:
- Always add `id BIGSERIAL PRIMARY KEY` UNLESS the table name contains `join`, `bridge`, `mapping`, `link`, or `association`
- Never add `created_at`/`updated_at` if the table name is a pure join/bridge table

Indexes to add automatically:
- If `user_id` column exists, add `CREATE INDEX idx_<table>_user ON <table>(user_id);`
- If `provider` column exists, add `CREATE INDEX idx_<table>_provider ON <table>(provider);`
- Composite unique on `(user_id, provider)` if both are present and no explicit unique constraint covers both

#### Index migration

```sql
CREATE INDEX IF NOT EXISTS <index_name> ON <table>(<columns>);
```

Down: `DROP INDEX IF EXISTS <index_name>;`

#### Raw migration

Prompt the user for the raw SQL to include. Write it verbatim into the up file. Down file contains `-- no automatic rollback for raw migrations`.

### 4. Generate down migration

#### Table down

```sql
DROP INDEX IF EXISTS idx_<table>_<col>;
DROP INDEX IF EXISTS idx_<table>_<col2>;
DROP TABLE IF EXISTS <table>;
```

Drop indexes in the same order they were declared in up, then the table.

#### Index down

```sql
DROP INDEX IF EXISTS <index_name>;
```

#### Raw down

```
-- no automatic rollback for raw migrations
```

### 5. Write files

Write to `src/api/database/migrations/`:
- `<NNNNNN>_<name>.up.sql`
- `<NNNNNN>_<name>.down.sql`

Use the table name (pluralized) for the migration name if a table migration.

### 6. Print next steps

After writing files, tell the user:

```
Migration files created:
- NNNNNN_<name>.up.sql
- NNNNNN_<name>.down.sql

Next steps:
1. Review the generated SQL in the files above
2. Apply the migration:
   cd src/api && migrate -path ./database/migrations -database "postgresql://alessio:password@localhost:5432/grepdocs?sslmode=disable" up
3. Regenerate dal layer:
   cd src/api && sqlc generate
```

## Examples

### Input: `repos:provider,text|repo_url,text|is_private,bool|is_public,bool`

```
NNNNNN_repos.up.sql
NNNNNN_repos.down.sql
```

### Input: `user_repo_mapping:user_id:bigint:references:users.id|repo_id:bigint:references:repos.id`

```
NNNNNN_user_repo_mapping.up.sql
NNNNNN_user_repo_mapping.down.sql
(no auto id, no timestamps)
```

### Input: `idx_repos_provider`

```
NNNNNN_idx_repos_provider.up.sql
NNNNNN_idx_repos_provider.down.sql
(creates index on repos(provider))
```

## Rules

- **Never** modify existing migration files
- **Never** run migrations or sqlc — just generate files and instruct the user
- **Always** use `CREATE TABLE IF NOT EXISTS` / `DROP TABLE IF EXISTS`
- **Always** generate both up and down files
- Handle edge cases: empty column list, missing types, invalid names
- If description is ambiguous or too short, ask the user for clarification before generating
