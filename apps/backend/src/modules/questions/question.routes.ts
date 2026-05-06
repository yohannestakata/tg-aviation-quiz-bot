import { Router } from "express";
import { archiveQuestion, createQuestion, getQuestionById, listQuestions, updateQuestion } from "@aviation/db";
import { asyncHandler } from "../../middleware/async-handler";
import { requireAdmin } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validate.middleware";
import { questionSchema, updateQuestionSchema } from "./question.schemas";

export const questionRouter = Router();

questionRouter.use(requireAdmin);

function idParam(req: { params: { id?: string } }) {
  if (!req.params.id) throw new Error("Missing id parameter");
  return req.params.id;
}

questionRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const questions = await listQuestions({
      categoryId: typeof req.query.categoryId === "string" ? req.query.categoryId : undefined,
      questionType:
        req.query.questionType === "multiple_choice" || req.query.questionType === "short_answer" ? req.query.questionType : undefined,
      difficulty:
        req.query.difficulty === "easy" || req.query.difficulty === "medium" || req.query.difficulty === "hard"
          ? req.query.difficulty
          : undefined,
      isActive: req.query.isActive === undefined ? undefined : req.query.isActive === "true",
      search: typeof req.query.search === "string" ? req.query.search : undefined
    });
    res.json({ questions });
  })
);

questionRouter.post(
  "/",
  validateBody(questionSchema),
  asyncHandler(async (req, res) => {
    const question = await createQuestion(req.body);
    res.status(201).json({ question });
  })
);

questionRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const question = await getQuestionById(idParam(req));
    if (!question) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    res.json({ question });
  })
);

questionRouter.patch(
  "/:id",
  validateBody(updateQuestionSchema),
  asyncHandler(async (req, res) => {
    const question = await updateQuestion(idParam(req), req.body);
    if (!question) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    res.json({ question });
  })
);

questionRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const question = await archiveQuestion(idParam(req));
    if (!question) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    res.json({ question });
  })
);
