-- {{id}}/001: schema for the {{name}} extension. Applied by the shell's migrate service as "{{id}}/001_init.sql".
CREATE SCHEMA IF NOT EXISTS {{schema}};

CREATE TABLE IF NOT EXISTS {{schema}}.items (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
{{profileCol}}  title       text NOT NULL,
  done        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
