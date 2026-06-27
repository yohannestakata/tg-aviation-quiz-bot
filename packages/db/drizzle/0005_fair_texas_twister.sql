ALTER TYPE "public"."quiz_play_mode" ADD VALUE 'race';--> statement-breakpoint
CREATE TABLE "daily_challenge_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"challenge_date" text NOT NULL,
	"selected_option_id" uuid,
	"answer_text" text,
	"is_correct" boolean NOT NULL,
	"elapsed_seconds" integer,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"badge" text NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_groups" ADD COLUMN "subscribed_to_daily" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_groups" ADD COLUMN "last_daily_posted_date" text;--> statement-breakpoint
ALTER TABLE "daily_challenge_answers" ADD CONSTRAINT "daily_challenge_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_challenge_answers" ADD CONSTRAINT "daily_challenge_answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_challenge_answers" ADD CONSTRAINT "daily_challenge_answers_selected_option_id_question_options_id_fk" FOREIGN KEY ("selected_option_id") REFERENCES "public"."question_options"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_user_date_idx" ON "daily_challenge_answers" USING btree ("user_id","challenge_date");--> statement-breakpoint
CREATE INDEX "daily_date_idx" ON "daily_challenge_answers" USING btree ("challenge_date");--> statement-breakpoint
CREATE UNIQUE INDEX "user_badge_unique_idx" ON "user_badges" USING btree ("user_id","badge");