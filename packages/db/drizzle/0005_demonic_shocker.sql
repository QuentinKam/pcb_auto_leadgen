ALTER TABLE "lead_scores" ALTER COLUMN "model_version" SET DEFAULT 'v2';--> statement-breakpoint
ALTER TABLE "lead_scores" ADD COLUMN "evidence" jsonb;--> statement-breakpoint
ALTER TABLE "lead_scores" ADD COLUMN "excluded" boolean DEFAULT false NOT NULL;