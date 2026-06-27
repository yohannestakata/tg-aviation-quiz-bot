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
  ["Human Performance", "human-performance", "Physiology, workload, and decision making"],
  ["Ethiopian Airlines", "ethiopian-airlines", "Ethiopian Airlines history, network, services, and operations"]
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

  await seedQuestion({
    categoryId: seededCategories.get("ethiopian-airlines")!,
    questionText: "When was Ethiopian Airlines founded?",
    questionType: "multiple_choice",
    correctAnswerText: "December 21, 1945",
    explanation: "Ethiopian Airlines' official overview lists its founding date as December 21, 1945.",
    options: [
      { optionText: "December 21, 1945", isCorrect: true },
      { optionText: "April 8, 1946" },
      { optionText: "December 1, 1955" },
      { optionText: "May 25, 1963" }
    ]
  });

  await seedQuestion({
    categoryId: seededCategories.get("ethiopian-airlines")!,
    questionText: "When did Ethiopian Airlines start operations?",
    questionType: "multiple_choice",
    correctAnswerText: "April 8, 1946",
    explanation: "The airline's official overview lists April 8, 1946 as the starting date of operation.",
    options: [
      { optionText: "December 21, 1945" },
      { optionText: "April 8, 1946", isCorrect: true },
      { optionText: "January 1, 1950" },
      { optionText: "September 12, 1974" }
    ]
  });

  await seedQuestion({
    categoryId: seededCategories.get("ethiopian-airlines")!,
    questionText: "What is Ethiopian Airlines' main hub?",
    questionType: "multiple_choice",
    correctAnswerText: "Addis Ababa Bole International Airport",
    explanation: "Ethiopian identifies Addis Ababa, Ethiopia as its main hub, with its head office at Bole International Airport.",
    options: [
      { optionText: "Addis Ababa Bole International Airport", isCorrect: true },
      { optionText: "Jomo Kenyatta International Airport" },
      { optionText: "Cairo International Airport" },
      { optionText: "Kotoka International Airport" }
    ]
  });

  await seedQuestion({
    categoryId: seededCategories.get("ethiopian-airlines")!,
    questionText: "Which global airline alliance did Ethiopian Airlines join in December 2011?",
    questionType: "multiple_choice",
    correctAnswerText: "Star Alliance",
    explanation: "Ethiopian Airlines joined Star Alliance in December 2011.",
    options: [
      { optionText: "oneworld" },
      { optionText: "SkyTeam" },
      { optionText: "Star Alliance", isCorrect: true },
      { optionText: "Vanilla Alliance" }
    ]
  });

  await seedQuestion({
    categoryId: seededCategories.get("ethiopian-airlines")!,
    questionText: "What is Ethiopian Airlines' frequent flyer program called?",
    questionType: "multiple_choice",
    correctAnswerText: "ShebaMiles",
    explanation: "ShebaMiles is Ethiopian Airlines' frequent flyer program.",
    options: [
      { optionText: "ShebaMiles", isCorrect: true },
      { optionText: "Cloud Rewards" },
      { optionText: "Bole Miles" },
      { optionText: "Aksum Club" }
    ]
  });

  const adminEmails = (process.env.SEED_ADMIN_EMAILS ?? process.env.SEED_ADMIN_EMAIL ?? "admin@example.com")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me";
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  for (const email of adminEmails) {
    await db.insert(admins).values({ email, passwordHash }).onConflictDoNothing({ target: admins.email });
  }

  console.log(`Seed complete. Admin accounts ensured: ${adminEmails.join(", ")}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
