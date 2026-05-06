import { Router } from "express";
import { getOverviewAnalytics } from "@aviation/db";
import { asyncHandler } from "../../middleware/async-handler";
import { requireAdmin } from "../../middleware/auth.middleware";

export const analyticsRouter = Router();

analyticsRouter.use(requireAdmin);

analyticsRouter.get(
  "/overview",
  asyncHandler(async (_req, res) => {
    res.json({ overview: await getOverviewAnalytics() });
  })
);

analyticsRouter.get(["/categories", "/questions", "/groups"], (_req, res) => {
  res.json({ data: [], note: "Detailed analytics endpoints are reserved for dashboard implementation." });
});
