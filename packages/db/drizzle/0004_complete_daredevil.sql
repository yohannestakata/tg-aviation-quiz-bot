ALTER TABLE "quiz_answers" ALTER COLUMN "points_awarded" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "play_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_played_date" text;