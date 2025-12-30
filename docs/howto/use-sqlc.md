# How to use sqlc for schema and queries

sqlc is a tool that generates
> fully type-safe idiomatic Go code from SQL

Basically you can write your sql (schema and queries)
and all interfaces (both for entities and for functions
that wrap the sql queries) will be generated as go
entities and available in the code to be used.

This guide wants to walk you through the steps to configure
and use sqlc (<https://github.com/sqlc-dev/sqlc>) with Postgres.

All sqlc documentation can be found at <https://docs.sqlc.dev/en/stable/index.html>.

## Install sqlc

First step is installing sqlc.
If you have go installed (which I assume is true since
you are probably developing a go application):

```bash
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
```

Otherwise you can install it for your operating system.
For example, on MacOS:

```bash
brew install sqlc
```

You can also use Docker, but for this and other info
I'm gonna redirect you to the official installation guide:
<https://docs.sqlc.dev/en/stable/overview/install.html>

Check if everything is okay with:

```bash
sqlc version
```

If you have some error like 'sqlc not found', it may be
because the GOPATH is not in your PATH environment variable.
Add to your `.bashrc` or `.zshrc` this line:

```bash
export PATH=$PATH:$(go env GOPATH)/bin
```

Open a new terminal window and you should be good to go.

## Setup sqlc

Create a file called `sqlc.yaml` in the directory of the go project.
Copy-paste this in the file:

```yaml
version: "2"
sql:
  - engine: "postgresql"
    queries: "sqlc/queries.sql"
    schema: "sqlc/schema.sql"
    gen:
      go:
        package: "dal"
        out: "dal"
        sql_package: "pgx/v5"
```

You can change the name of the package (where the created go
interfaces will belong to) and the out, which is the directory
where the go files will be output.
Queries and schema point to the sql files where the queries
and the schema ddl are written.

The schema file can be something like this:

```sql
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    fullname text NOT NULL,
    username text NULL,
    email text NOT NULL,
    google_id text NOT NULL,
    created_at timestamp with time zone NOT NULL
)
```

While the queries file is something like this:

```sql
-- name: GetUserByGoogleId :one
SELECT * FROM users
WHERE google_id = $1 LIMIT 1;

-- name: CreateUser :one
INSERT INTO users (
    fullname,
    email,
    google_id,
    created_at
) VALUES (
    $1, $2, $3, $4
)
RETURNING *;
```

Where the comment line above the query indicates the name
of the go function that will wrap that query and then `:one`
(or `:many` or `:exec`) which indicate that the query will
return only one row.

## Generate go code from sql

Now you are ready to generate the go interface from the
sql schema and queries that you have just added.
From the directory where `sqlc.yaml` is located, run the command:

```bash
sqlc generate
```

Note: before trying to execute the code, add `pgx` to your
go modules with:

```bash
go get github.com/jackc/pgx/v5
```

You can now use the created interfaces and functions in your
project, and also see the created go code in the directory `dal/`
(or wherever you chose to output the files in the sqlc.yaml).

Example of using the generated code:

```go
ctx := context.Background()

conn, err := pgx.Connect(ctx, "user=pqgotest dbname=pqgotest sslmode=verify-full")
if err != nil {
    return err
}
defer conn.Close(ctx)

queries := dal.New(conn)

// create a user
insertedUser, err := queries.CreateUser(ctx, dal.CreateAuthorParams{
    FullName: "Brian Kernighan",
    Email: "brian.kerninghan@example.com",
    GoogleId: "exampleid",
    CreatedAt: pgtype.Timestamptz{},
})
if err != nil {
    return err
}
log.Println(insertedUser)

// get the user we just inserted
fetchedUser, err := queries.GetUserByGoogleId(ctx, insertedUser.GoogleID)
if err != nil {
    return err
}
```

## Integration with golang-migrate

If you want to integrate sqlc with migrations handled with golang-migrate,
you can change the `schema` field to point to the directories where
migrations are located:

```yaml
    schema: "database/migrations"
```

sqlc read only the `*.up.sql` files, ignoring the `*.down.sql` ones.
In this way, every time you run the `sqlc generate` command, the
generated classes will reflect the latest migration.
Of course, make sure you apply those migrations to the database before
running the updated code, or you may run into problems.
