CREATE TABLE "email_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"format" varchar(30) DEFAULT 'cold_email' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"target_score_min" integer,
	"target_score_max" integer,
	"total_targets" integer DEFAULT 0 NOT NULL,
	"total_sent" integer DEFAULT 0 NOT NULL,
	"total_delivered" integer DEFAULT 0 NOT NULL,
	"total_opened" integer DEFAULT 0 NOT NULL,
	"total_clicked" integer DEFAULT 0 NOT NULL,
	"total_replied" integer DEFAULT 0 NOT NULL,
	"total_bounced" integer DEFAULT 0 NOT NULL,
	"total_complained" integer DEFAULT 0 NOT NULL,
	"is_warmup" boolean DEFAULT false NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"content_draft_id" uuid,
	"resend_message_id" varchar(255),
	"from_email" varchar(255) NOT NULL,
	"from_name" varchar(255),
	"to_email" varchar(255) NOT NULL,
	"to_name" varchar(255),
	"sending_domain" varchar(255) NOT NULL,
	"subject" text,
	"body_snapshot" text NOT NULL,
	"variant" varchar(1) DEFAULT 'A',
	"status" varchar(30) DEFAULT 'queued' NOT NULL,
	"retry_count" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"first_opened_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"open_count" integer DEFAULT 0 NOT NULL,
	"first_clicked_at" timestamp with time zone,
	"last_clicked_at" timestamp with time zone,
	"click_count" integer DEFAULT 0 NOT NULL,
	"bounced_at" timestamp with time zone,
	"bounce_type" varchar(20),
	"complained_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"send_id" uuid,
	"resend_message_id" varchar(255),
	"resend_event_id" varchar(255),
	"event_type" varchar(30) NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"url" text,
	"link_tag" varchar(100),
	"bounce_type" varchar(20),
	"bounce_subtype" varchar(50),
	"diagnostic_code" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_content_draft_id_fk" FOREIGN KEY ("content_draft_id") REFERENCES "public"."content_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_send_id_fk" FOREIGN KEY ("send_id") REFERENCES "public"."email_sends"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_campaigns_tenant_status_idx" ON "email_campaigns" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "email_campaigns_tenant_warmup_idx" ON "email_campaigns" USING btree ("tenant_id","is_warmup");--> statement-breakpoint
CREATE INDEX "email_sends_tenant_status_idx" ON "email_sends" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "email_sends_tenant_domain_idx" ON "email_sends" USING btree ("tenant_id","sending_domain","created_at");--> statement-breakpoint
CREATE INDEX "email_sends_tenant_from_email_idx" ON "email_sends" USING btree ("tenant_id","from_email","created_at");--> statement-breakpoint
CREATE INDEX "email_sends_resend_message_id_idx" ON "email_sends" USING btree ("resend_message_id");--> statement-breakpoint
CREATE INDEX "email_events_tenant_event_type_idx" ON "email_events" USING btree ("tenant_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "email_events_tenant_send_idx" ON "email_events" USING btree ("tenant_id","send_id","created_at");--> statement-breakpoint
CREATE INDEX "email_events_resend_event_id_idx" ON "email_events" USING btree ("resend_event_id");