#!/usr/bin/env bash
# db-url.sh — small, dependency-free helpers for manipulating PostgreSQL
# connection strings in shell scripts.
#
# Source this file, then call the functions below.

# amana_pg_maintenance_url <database_url>
#
# Derive the maintenance-database URL ("postgres") for the same server and role
# as the supplied PostgreSQL connection URL.
#
# The database-name segment is replaced with "postgres" while any query
# parameters (e.g. ?sslmode=require, common on hosted Postgres such as RDS) and
# fragment are preserved. Unlike `"${DATABASE_URL%/$DB_NAME}"`, this does not
# depend on the URL ending literally in the database name, so it keeps working
# when the URL carries a query string.
#
# Examples:
#   postgresql://u:p@host:5432/amana
#     -> postgresql://u:p@host:5432/postgres
#   postgresql://u:p@host:5432/amana?sslmode=require
#     -> postgresql://u:p@host:5432/postgres?sslmode=require
amana_pg_maintenance_url() {
  local db_url="$1"
  local query=""
  local fragment=""
  local work="$db_url"

  # Peel the fragment (#...) and query string (?...) off the end, remembering
  # them so they can be re-attached to the maintenance URL.
  if [[ "$work" == *"#"* ]]; then
    fragment="#${work#*#}"
    work="${work%%#*}"
  fi
  if [[ "$work" == *"?"* ]]; then
    query="?${work#*\?}"
    work="${work%%\?*}"
  fi

  # Prefix is everything up to and including the authority (scheme://user:pass@host:port),
  # i.e. the URL with the database-path segment removed.
  local prefix="$work"
  if [[ "$work" == *"://"* ]]; then
    local scheme="${work%%://*}"
    local rest="${work#*://}"
    local authority="${rest%%/*}"
    prefix="${scheme}://${authority}"
  fi

  printf '%s/postgres%s%s\n' "$prefix" "$query" "$fragment"
}
