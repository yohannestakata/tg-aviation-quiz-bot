import { Router } from "express";
import multer from "multer";
import { cloudinary } from "../../config/cloudinary";
import { env } from "../../config/env";
import { asyncHandler } from "../../middleware/async-handler";
import { requireAdmin } from "../../middleware/auth.middleware";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype)) {
      cb(new Error("Only image uploads are allowed"));
      return;
    }
    cb(null, true);
  }
});

export const uploadRouter = Router();

uploadRouter.use(requireAdmin);

uploadRouter.post(
  "/question-image",
  upload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "Missing image file" });
      return;
    }

    if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
      res.status(503).json({ error: "Cloudinary is not configured" });
      return;
    }

    const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "aviation-quiz/questions",
          resource_type: "image"
        },
        (error, uploadResult) => {
          if (error || !uploadResult) {
            reject(error ?? new Error("Cloudinary upload failed"));
            return;
          }
          resolve(uploadResult);
        }
      );
      stream.end(req.file!.buffer);
    });

    res.status(201).json({
      imageUrl: result.secure_url,
      publicId: result.public_id
    });
  })
);
