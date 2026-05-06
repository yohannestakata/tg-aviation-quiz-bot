import { z } from "zod";

const optionSchema = z.object({
  optionText: z.string().min(1),
  isCorrect: z.boolean().optional(),
  displayOrder: z.number().int().optional()
});

const questionBaseSchema = z.object({
  categoryId: z.string().uuid(),
  questionText: z.string().min(1),
  questionType: z.enum(["multiple_choice", "short_answer"]),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  imageUrl: z.string().url().optional().nullable(),
  cloudinaryPublicId: z.string().optional().nullable(),
  correctAnswerText: z.string().optional().nullable(),
  acceptedKeywords: z.array(z.string().min(1)).optional(),
  explanation: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  options: z.array(optionSchema).optional()
});

function validateQuestionShape(value: z.infer<typeof questionBaseSchema>, ctx: z.RefinementCtx) {
  if (value.questionType === "multiple_choice") {
    if (!value.options || value.options.length < 2) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Multiple choice questions need at least 2 options" });
    }
    if (!value.options?.some((option) => option.isCorrect)) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "One option must be marked correct" });
    }
  }

  if (value.questionType === "short_answer" && !value.correctAnswerText && !value.acceptedKeywords?.length) {
    ctx.addIssue({
      code: "custom",
      path: ["correctAnswerText"],
      message: "Short answer questions need a correct answer or accepted keywords"
    });
  }
}

export const questionSchema = questionBaseSchema.superRefine(validateQuestionShape);

export const updateQuestionSchema = questionBaseSchema.partial().superRefine((value, ctx) => {
  if (value.questionType) validateQuestionShape(value as z.infer<typeof questionBaseSchema>, ctx);
});
