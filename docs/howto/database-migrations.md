# Database Migrations

As of now, the solution adopted to apply migrations to the database is
*golang-migrate*.
This tool does not automatically generate the migration files, but
those should be written by hand.
Each migration should have a `*.up.sql` file that is used to apply
the migration, and a `*.down.sql` that is used to rollback the
migration.

First, install `golang-migrate` for postgres:

```bash
go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest
```

To create a new (empty) migration:

```bash
migrate create -ext sql -dir ./database/migrations -seq create_users_table
```

You can change the output directory and the migration name to whatever
you want.
The flag `-ext sql` sets the output format to `.sql`, while the `-seq`
flag generates sequential version numbers, which are crucial for the
order of the migrations.

Once you've populated the migration files, you can apply all the
pending migrations with this command (clearly change the connection string):

```bash
migrate -path ./database/migrations -database "postgresql://<username>:<password>@localhost:5432/<mydatabase>?sslmode=disable" up
```

You can also add a number after up (e.g. `... up 2`) that indicates the
number of pending migrations to apply, just in case you wanted to only
apply some of them.

The tool automatically generates a table in the database called
`schema_migrations`, that you can query to check what migrations were
applied:

```sql
SELECT * FROM schema_migrations;
```
