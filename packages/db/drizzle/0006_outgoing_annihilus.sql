CREATE TABLE "duels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenger_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"winner_id" uuid,
	"challenger_score" integer DEFAULT 0 NOT NULL,
	"target_score" integer DEFAULT 0 NOT NULL,
	"challenger_correct" integer DEFAULT 0 NOT NULL,
	"target_correct" integer DEFAULT 0 NOT NULL,
	"total_questions" integer NOT NULL,
	"challenger_fastest_secs" integer,
	"target_fastest_secs" integer,
	"played_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_challenger_id_users_id_fk" FOREIGN KEY ("challenger_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "duels_challenger_idx" ON "duels" USING btree ("challenger_id");--> statement-breakpoint
CREATE INDEX "duels_target_idx" ON "duels" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "duels_played_at_idx" ON "duels" USING btree ("played_at");