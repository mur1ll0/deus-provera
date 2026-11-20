ALTER TABLE "attempt" ADD COLUMN "score_detail" jsonb;--> statement-breakpoint
ALTER TABLE "attempt_answer" ADD COLUMN "revealed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_attempt_reason" ON "points_ledger" USING btree ("attempt_id","reason");