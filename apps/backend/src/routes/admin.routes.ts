import { Router } from "express";
import { analyticsRouter } from "../modules/analytics/analytics.routes";
import { authRouter } from "../modules/auth/auth.routes";
import { categoryRouter } from "../modules/categories/category.routes";
import { questionRouter } from "../modules/questions/question.routes";
import { uploadRouter } from "../modules/uploads/upload.routes";

export const adminRouter = Router();

adminRouter.use("/auth", authRouter);
adminRouter.use("/categories", categoryRouter);
adminRouter.use("/questions", questionRouter);
adminRouter.use("/uploads", uploadRouter);
adminRouter.use("/analytics", analyticsRouter);
