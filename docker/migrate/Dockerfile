# The database scripts of `migrate` and `ext-migrate`: the core migrations, the roles and the scripts that
# apply them, baked in from main. They run as the Postgres superuser, so they never come from the checkout
# that the agents in the terminal edit: the updater builds this image from its mirror of GitHub main
# (spec 006), and a core migration goes live only once it is on main. Extension migrations still come from
# the checkout's extensions/ folder; they run as each extension's own owner role, not the superuser.
# Build context: the repo root, narrowed by /.dockerignore to db/.
FROM postgres:18-alpine
COPY db/migrations/ /migrations/
COPY db/roles.sql db/extension-role.sql db/migrate.sh db/watch-extensions.sh /
