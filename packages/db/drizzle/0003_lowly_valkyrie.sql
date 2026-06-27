ALTER TABLE "quiz_answers" ALTER COLUMN "points_awarded" SET DATA TYPE numeric(5, 2);--> statement-breakpoint
ALTER TABLE "quiz_answers" ALTER COLUMN "points_awarded" SET DEFAULT '0';