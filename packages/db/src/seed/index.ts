import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { admins, categories, questionOptions, questions } from "../schema";

const categorySeed = [
  ["Aerodynamics", "aerodynamics", "Lift, drag, stalls, and flight principles"],
  ["Aircraft Systems", "aircraft-systems", "Aircraft engines, electrics, fuel, and hydraulics"],
  ["Meteorology", "meteorology", "Weather theory and aviation weather interpretation"],
  ["Navigation", "navigation", "Charts, headings, tracks, and navigation procedures"],
  ["Air Law", "air-law", "Rules, regulations, and operational limitations"],
  ["Human Performance", "human-performance", "Physiology, workload, and decision making"]
] as const;

async function upsertCategory(name: string, slug: string, description: string, displayOrder: number) {
  const [category] = await db
    .insert(categories)
    .values({ name, slug, description, displayOrder })
    .onConflictDoUpdate({
      target: categories.slug,
      set: { name, description, displayOrder, isActive: true }
    })
    .returning();
  if (!category) throw new Error(`Failed to seed category ${slug}`);
  return category;
}

async function seedQuestion(input: {
  categoryId: string;
  questionText: string;
  questionType: "multiple_choice" | "short_answer";
  correctAnswerText?: string;
  acceptedKeywords?: string[];
  explanation: string;
  options?: Array<{ optionText: string; isCorrect?: boolean }>;
}) {
  const [existing] = await db.select().from(questions).where(eq(questions.questionText, input.questionText)).limit(1);
  if (existing) return existing;

  const [question] = await db
    .insert(questions)
    .values({
      categoryId: input.categoryId,
      questionText: input.questionText,
      questionType: input.questionType,
      correctAnswerText: input.correctAnswerText ?? null,
      acceptedKeywords: input.acceptedKeywords ?? [],
      explanation: input.explanation
    })
    .returning();
  if (!question) throw new Error("Failed to seed question");

  if (input.options?.length) {
    await db.insert(questionOptions).values(
      input.options.map((option, index) => ({
        questionId: question.id,
        optionText: option.optionText,
        isCorrect: option.isCorrect ?? false,
        displayOrder: index
      }))
    );
  }

  return question;
}

async function main() {
  const seededCategories = new Map<string, string>();
  for (const [index, item] of categorySeed.entries()) {
    const category = await upsertCategory(item[0], item[1], item[2], index);
    seededCategories.set(item[1], category.id);
  }

  await seedQuestion({
    categoryId: seededCategories.get("aerodynamics")!,
    questionText: "What does angle of attack refer to?",
    questionType: "multiple_choice",
    correctAnswerText: "The angle between the wing chord line and relative airflow",
    explanation: "Angle of attack is measured between the chord line and the relative airflow.",
    options: [
      { optionText: "The angle between the wing chord line and relative airflow", isCorrect: true },
      { optionText: "The angle between the runway and aircraft nose" },
      { optionText: "The angle between true north and magnetic north" },
      { optionText: "The angle between the elevator and stabilizer" }
    ]
  });

  await seedQuestion({
    categoryId: seededCategories.get("aerodynamics")!,
    questionText: "What are the four forces of flight?",
    questionType: "short_answer",
    correctAnswerText: "lift weight thrust drag",
    acceptedKeywords: ["lift", "weight", "thrust", "drag"],
    explanation: "The four forces are lift, weight, thrust, and drag."
  });

  await seedQuestion({
    categoryId: seededCategories.get("meteorology")!,
    questionText: "Which cloud type is most associated with thunderstorms?",
    questionType: "multiple_choice",
    correctAnswerText: "Cumulonimbus",
    explanation: "Cumulonimbus clouds are vertically developed storm clouds.",
    options: [
      { optionText: "Cirrus" },
      { optionText: "Stratus" },
      { optionText: "Cumulonimbus", isCorrect: true },
      { optionText: "Altostratus" }
    ]
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me";
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await db
    .insert(admins)
    .values({ email: adminEmail.toLowerCase(), passwordHash })
    .onConflictDoNothing({ target: admins.email });

  console.log("Seed complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
