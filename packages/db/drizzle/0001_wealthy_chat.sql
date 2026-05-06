CREATE TYPE "public"."quiz_play_mode" AS ENUM('individual', 'free_form', 'teams');--> statement-breakpoint
ALTER TABLE "quiz_answers" ADD COLUMN "team_name" text;--> statement-breakpoint
ALTER TABLE "quiz_sessions" ADD COLUMN "play_mode" "quiz_play_mode" DEFAULT 'individual' NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_sessions" ADD COLUMN "team_names" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_sessions" ADD COLUMN "team_join_mode" text;--> statement-breakpoint
ALTER TABLE "quiz_sessions" ADD COLUMN "team_members" jsonb DEFAULT '{}'::jsonb NOT NULL;