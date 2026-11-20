CREATE TYPE "public"."content_source" AS ENUM('usuario', 'ia');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('facil', 'media', 'dificil');--> statement-breakpoint
CREATE TYPE "public"."grader_kind" AS ENUM('auto', 'checklist', 'ia');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('rascunho', 'processando', 'revisao', 'concluida', 'falhou', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."question_origin" AS ENUM('pdf_ia', 'agente_externo', 'manual');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('objetiva', 'discursiva');--> statement-breakpoint
CREATE TYPE "public"."simulado_mode" AS ENUM('prova', 'treino');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('privada', 'publica');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"task" text NOT NULL,
	"model" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"task" text NOT NULL,
	"model" text NOT NULL,
	"ok" boolean NOT NULL,
	"error_kind" text,
	"latency_ms" integer NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alternative" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"correct" boolean NOT NULL,
	"explanation" text,
	"source" "content_source" DEFAULT 'usuario' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "area" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "area_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"mode" "simulado_mode" NOT NULL,
	"config" jsonb NOT NULL,
	"question_ids" jsonb NOT NULL,
	"time_limit_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"total_time_ms" integer,
	"accuracy" real,
	"points" integer,
	"counts_for_ranking" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempt_answer" (
	"attempt_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"presented_as" "question_type" NOT NULL,
	"choice_id" uuid,
	"text" text,
	"score" real,
	"graded_by" "grader_kind",
	"revealed_before_answer" boolean DEFAULT false NOT NULL,
	"used_hint" boolean DEFAULT false NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "attempt_answer_attempt_id_item_id_pk" PRIMARY KEY("attempt_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "attempt_question" (
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"time_ms" integer DEFAULT 0 NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	CONSTRAINT "attempt_question_attempt_id_question_id_pk" PRIMARY KEY("attempt_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "discipline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"area_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"source" "question_origin" NOT NULL,
	"file_name" text,
	"status" "import_status" DEFAULT 'rascunho' NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"guardrail_risk" text,
	"ai_requests" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "points_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"attempt_id" uuid,
	"area_id" uuid,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"institution" text,
	"course" text,
	"show_in_ranking" boolean DEFAULT true NOT NULL,
	"openrouter_key_enc" text,
	"privacy_ack_at" timestamp with time zone,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"group_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"discipline_id" uuid NOT NULL,
	"topic" text,
	"source_label" text,
	"stem" text NOT NULL,
	"summary" text,
	"difficulty" "difficulty" DEFAULT 'media' NOT NULL,
	"visibility" "visibility" DEFAULT 'privada' NOT NULL,
	"origin" "question_origin" NOT NULL,
	"has_image" boolean DEFAULT false NOT NULL,
	"image_description" text,
	"content_hash" text NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"times_answered" integer DEFAULT 0 NOT NULL,
	"times_correct" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "question_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"area_id" uuid NOT NULL,
	"discipline_id" uuid NOT NULL,
	"topic" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text,
	"prompt" text DEFAULT '' NOT NULL,
	"type" "question_type" NOT NULL,
	"expected_answer" text,
	"key_points" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_call" ADD CONSTRAINT "ai_call_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alternative" ADD CONSTRAINT "alternative_item_id_question_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."question_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_answer" ADD CONSTRAINT "attempt_answer_attempt_id_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_answer" ADD CONSTRAINT "attempt_answer_item_id_question_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."question_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_answer" ADD CONSTRAINT "attempt_answer_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_answer" ADD CONSTRAINT "attempt_answer_choice_id_alternative_id_fk" FOREIGN KEY ("choice_id") REFERENCES "public"."alternative"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_question" ADD CONSTRAINT "attempt_question_attempt_id_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_question" ADD CONSTRAINT "attempt_question_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discipline" ADD CONSTRAINT "discipline_area_id_area_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_attempt_id_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempt"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_area_id_area_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_group_id_question_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."question_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_area_id_area_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_discipline_id_discipline_id_fk" FOREIGN KEY ("discipline_id") REFERENCES "public"."discipline"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_group" ADD CONSTRAINT "question_group_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_group" ADD CONSTRAINT "question_group_area_id_area_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_group" ADD CONSTRAINT "question_group_discipline_id_discipline_id_fk" FOREIGN KEY ("discipline_id") REFERENCES "public"."discipline"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_item" ADD CONSTRAINT "question_item_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_call_day" ON "ai_call" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_call_model" ON "ai_call" USING btree ("model","created_at");--> statement-breakpoint
CREATE INDEX "alternative_item" ON "alternative" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "attempt_user" ON "attempt" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "answer_item" ON "attempt_answer" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "answer_question" ON "attempt_answer" USING btree ("question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discipline_area_slug" ON "discipline" USING btree ("area_id","slug");--> statement-breakpoint
CREATE INDEX "import_owner" ON "import_job" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_period" ON "points_ledger" USING btree ("created_at","user_id");--> statement-breakpoint
CREATE INDEX "ledger_user" ON "points_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "question_owner" ON "question" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "question_filter" ON "question" USING btree ("visibility","area_id","discipline_id");--> statement-breakpoint
CREATE INDEX "question_topic" ON "question" USING btree ("discipline_id","topic");--> statement-breakpoint
CREATE UNIQUE INDEX "question_owner_hash" ON "question" USING btree ("owner_id","content_hash") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "qgroup_owner" ON "question_group" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "item_question" ON "question_item" USING btree ("question_id","position");