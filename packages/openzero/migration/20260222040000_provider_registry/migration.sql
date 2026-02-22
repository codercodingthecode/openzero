CREATE TABLE "provider" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "api" text,
  "npm" text,
  "env" text,
  "auth" text,
  "api_key" text,
  "enabled" integer DEFAULT 1 NOT NULL,
  "last_updated" integer NOT NULL,
  "data" text
);

CREATE TABLE "provider_model" (
  "id" text PRIMARY KEY NOT NULL,
  "provider_id" text NOT NULL,
  "model_id" text NOT NULL,
  "name" text NOT NULL,
  "family" text,
  "modalities" text,
  "cost" text,
  "limits" text,
  "dimension" integer,
  "status" text DEFAULT 'active',
  "data" text,
  "last_updated" integer NOT NULL,
  FOREIGN KEY ("provider_id") REFERENCES "provider"("id") ON UPDATE no action ON DELETE cascade
);

CREATE INDEX "provider_model_provider_idx" ON "provider_model" ("provider_id");
CREATE INDEX "provider_model_modality_idx" ON "provider_model" ("modalities");
