import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import {
  SUPPORTED_MATERIAL_EXTENSIONS,
  ingestMaterial,
  isSupportedMaterialFile,
  searchMaterialChunks,
} from "../services/material.service";

const router = Router();

const MAX_FILE_SIZE = 15 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
});

const materialIdSchema = z.uuid();

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

const uploadMaterialSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: optionalText(5000),
  topic: optionalText(200),
  context: z
    .enum(["DAILY_LIFE", "ENVIRONMENT", "TECHNOLOGY"])
    .optional()
    .or(z.literal("").transform(() => undefined)),
  caseId: z
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

const searchSchema = z
  .object({
    query: z.string().trim().min(3).max(2000),
    caseId: z.uuid().optional(),
    context: z.enum(["DAILY_LIFE", "ENVIRONMENT", "TECHNOLOGY"]).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

const materialSelect = {
  id: true,
  title: true,
  description: true,
  topic: true,
  context: true,
  caseId: true,
  case: {
    select: {
      id: true,
      title: true,
    },
  },
  fileName: true,
  mimeType: true,
  fileSize: true,
  charCount: true,
  status: true,
  errorMessage: true,
  embeddingModel: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      chunks: true,
    },
  },
} as const;

function handleUpload(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      res.status(400).json({
        success: false,
        message:
          error.code === "LIMIT_FILE_SIZE"
            ? "Ukuran file maksimal 15 MB"
            : `Upload gagal: ${error.message}`,
      });
      return;
    }

    if (error) {
      next(error);
      return;
    }

    next();
  });
}

// GET /api/admin/materials
router.get(
  "/materials",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    try {
      const materials = await prisma.learningMaterial.findMany({
        orderBy: { createdAt: "desc" },
        select: materialSelect,
      });

      res.status(200).json({
        success: true,
        message: "Learning materials retrieved successfully",
        data: materials,
      });
    } catch (error) {
      console.error("Failed to list learning materials:", error);

      res.status(500).json({
        success: false,
        message: "Failed to retrieve learning materials",
      });
    }
  }
);

// POST /api/admin/materials (multipart/form-data)
// Upload a document, convert it into embeddings and store it in pgvector
router.post(
  "/materials",
  requireAuth,
  requireRole("ADMIN"),
  handleUpload,
  async (req, res) => {
    const file = req.file;

    if (!file) {
      res.status(400).json({
        success: false,
        message: "File materi wajib diunggah",
      });
      return;
    }

    if (!isSupportedMaterialFile(file.originalname)) {
      res.status(400).json({
        success: false,
        message: `Format file tidak didukung. Gunakan ${SUPPORTED_MATERIAL_EXTENSIONS.join(", ")}`,
      });
      return;
    }

    const parsed = uploadMaterialSchema.safeParse(req.body ?? {});

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Data materi tidak valid",
        errors: parsed.error.flatten(),
      });
      return;
    }

    const { title, description, topic, context, caseId } = parsed.data;

    try {
      if (caseId) {
        const caseStudy = await prisma.validatedCase.findUnique({
          where: { id: caseId },
          select: { id: true },
        });

        if (!caseStudy) {
          res.status(404).json({
            success: false,
            message: "Studi kasus yang dipilih tidak ditemukan",
          });
          return;
        }
      }

      const material = await prisma.learningMaterial.create({
        data: {
          title,
          description,
          topic,
          context,
          caseId,
          fileName: file.originalname,
          mimeType: file.mimetype || "application/octet-stream",
          fileSize: file.size,
          status: "PROCESSING",
          uploadedById: res.locals.user?.id ?? null,
        },
        select: { id: true },
      });

      try {
        await ingestMaterial(material.id, file.buffer, file.originalname);
      } catch (ingestError) {
        console.error("Failed to ingest learning material:", ingestError);
      }

      const saved = await prisma.learningMaterial.findUnique({
        where: { id: material.id },
        select: materialSelect,
      });

      if (saved?.status === "FAILED") {
        res.status(422).json({
          success: false,
          message: `Materi tersimpan tetapi gagal diproses: ${saved.errorMessage ?? "kesalahan tidak diketahui"}`,
          data: saved,
        });
        return;
      }

      res.status(201).json({
        success: true,
        message: "Materi berhasil diunggah dan diubah menjadi vector",
        data: saved,
      });
    } catch (error) {
      console.error("Failed to upload learning material:", error);

      res.status(500).json({
        success: false,
        message: "Failed to upload learning material",
      });
    }
  }
);

// DELETE /api/admin/materials/:id
router.delete(
  "/materials/:id",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsedId = materialIdSchema.safeParse(req.params.id);

    if (!parsedId.success) {
      res.status(400).json({
        success: false,
        message: "Invalid material ID",
      });
      return;
    }

    try {
      const result = await prisma.learningMaterial.deleteMany({
        where: { id: parsedId.data },
      });

      if (result.count === 0) {
        res.status(404).json({
          success: false,
          message: "Material not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Materi berhasil dihapus",
        data: { id: parsedId.data },
      });
    } catch (error) {
      console.error("Failed to delete learning material:", error);

      res.status(500).json({
        success: false,
        message: "Failed to delete learning material",
      });
    }
  }
);

// POST /api/admin/materials/search
// Test semantic retrieval over uploaded materials
router.post(
  "/materials/search",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsed = searchSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid search request",
        errors: parsed.error.flatten(),
      });
      return;
    }

    try {
      const results = await searchMaterialChunks({
        ...parsed.data,
        minSimilarity: 0,
      });

      res.status(200).json({
        success: true,
        message: "Search completed",
        data: results,
      });
    } catch (error) {
      console.error("Failed to search learning materials:", error);

      res.status(500).json({
        success: false,
        message:
          error instanceof Error && /vector|OPENAI/i.test(error.message)
            ? `Pencarian gagal: ${error.message}`
            : "Failed to search learning materials",
      });
    }
  }
);

export default router;
