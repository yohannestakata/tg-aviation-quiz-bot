import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
};

export const questionTypeEnum = pgEnum("question_type", ["multiple_choice", "short_answer"]);
export const difficultyLevelEnum = pgEnum("difficulty_level", ["easy", "medium", "hard"]);
export const quizModeEnum = pgEnum("quiz_mode", ["private", "group"]);
export const quizStatusEnum = pgEnum("quiz_status", ["active", "completed", "cancelled"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  telegramUserId: text("telegram_user_id").notNull().unique(),
  username: text("username"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  languageCode: text("language_code"),
  ...timestamps
});

export const telegramGroups = pgTable("telegram_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  telegramChatId: text("telegram_chat_id").notNull().unique(),
  title: text("title"),
  type: text("type"),
  ...timestamps
});

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    isActive: boolean("is_active").default(true).notNull(),
    displayOrder: integer("display_order").default(0).notNull(),
    ...timestamps
  },
  (table) => ({
    categoriesSlugIdx: uniqueIndex("categories_slug_idx").on(table.slug)
  })
);

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "restrict" }).notNull(),
    questionText: text("question_text").notNull(),
    questionType: questionTypeEnum("question_type").notNull(),
    difficulty: difficultyLevelEnum("difficulty").default("medium").notNull(),
    imageUrl: text("image_url"),
    cloudinaryPublicId: text("cloudinary_public_id"),
    correctAnswerText: text("correct_answer_text"),
    acceptedKeywords: text("accepted_keywords").array().default([]).notNull(),
    explanation: text("explanation"),
    isActive: boolean("is_active").default(true).notNull(),
    ...timestamps
  },
  (table) => ({
    questionsCategoryIdx: index("questions_category_idx").on(table.categoryId),
    questionsSearchIdx: index("questions_search_idx").on(table.questionText)
  })
);

export const questionOptions = pgTable(
  "question_options",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    questionId: uuid("question_id").references(() => questions.id, { onDelete: "cascade" }).notNull(),
    optionText: text("option_text").notNull(),
    isCorrect: boolean("is_correct").default(false).notNull(),
    displayOrder: integer("display_order").default(0).notNull(),
    ...timestamps
  },
  (table) => ({
    questionOptionsQuestionIdx: index("question_options_question_idx").on(table.questionId)
  })
);

export const quizSessions = pgTable("quiz_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  mode: quizModeEnum("mode").notNull(),
  status: quizStatusEnum("status").default("active").notNull(),
  userId: uuid("user_id").references(() => users.id),
  groupId: uuid("group_id").references(() => telegramGroups.id),
  categoryId: uuid("category_id").references(() => categories.id),
  questionType: questionTypeEnum("question_type"),
  totalQuestions: integer("total_questions").notNull(),
  currentQuestionIndex: integer("current_question_index").default(0).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true })
});

export const quizSessionQuestions = pgTable(
  "quiz_session_questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quizSessionId: uuid("quiz_session_id").references(() => quizSessions.id, { onDelete: "cascade" }).notNull(),
    questionId: uuid("question_id").references(() => questions.id, { onDelete: "restrict" }).notNull(),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    sessionQuestionsSessionIdx: index("session_questions_session_idx").on(table.quizSessionId)
  })
);

export const quizAnswers = pgTable(
  "quiz_answers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quizSessionId: uuid("quiz_session_id").references(() => quizSessions.id, { onDelete: "cascade" }).notNull(),
    questionId: uuid("question_id").references(() => questions.id, { onDelete: "restrict" }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }).notNull(),
    selectedOptionId: uuid("selected_option_id").references(() => questionOptions.id),
    answerText: text("answer_text"),
    isCorrect: boolean("is_correct").notNull(),
    pointsAwarded: integer("points_awarded").default(0).notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    quizAnswersSessionIdx: index("quiz_answers_session_idx").on(table.quizSessionId),
    quizAnswersUserIdx: index("quiz_answers_user_idx").on(table.userId)
  })
);

export const admins = pgTable("admins", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").default("admin").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps
});

export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  adminId: uuid("admin_id").references(() => admins.id),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Question = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;
export type QuestionOption = typeof questionOptions.$inferSelect;
export type User = typeof users.$inferSelect;
export type Admin = typeof admins.$inferSelect;
