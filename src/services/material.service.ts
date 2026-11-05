import mammoth from "mammoth";

import { env } from "../config/env";
import { getOpenAIClient } from "../lib/openai";
import { prisma } from "../lib/prisma";

// pdf-parse's index.js runs a self-test when imported directly,
// so load the library entry point instead.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse: (buffer: Buffer) => Promise<{ text: string }> = require("pdf-parse/lib/pdf-parse.js");

export const EMBEDDING_DIMENSIONS = 1536;

export const SUPPORTED_MATERIAL_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;
const EMBEDDING_BATCH_SIZE = 64;

export interface RetrievedChunk {
  id: string;
  materialId: string;
  materialTitle: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

function getExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

export function isSupportedMaterialFile(fileName: string): boolean {
  return SUPPORTED_MATERIAL_EXTENSIONS.includes(getExtension(fileName));
}

/**
 * Extracts plain text from an uploaded document.
 */
export async function extractMaterialText(
  buffer: Buffer,
  fileName: string
): Promise<string> {
  const extension = getExtension(fileName);

  let text: string;

  switch (extension) {
    case ".pdf":
      text = (await pdfParse(buffer)).text;
      break;
    case ".docx":
      text = (await mammoth.extractRawText({ buffer })).value;
      break;
    case ".txt":
    case ".md":
      text = buffer.toString("utf8");
      break;
    default:
      throw new Error("UNSUPPORTED_FILE_TYPE");
  }

  return normalizeText(text);
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Splits text into overlapping chunks, preferring paragraph
 * and sentence boundaries so each chunk stays coherent.
 */
export function chunkText(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  // Break paragraphs that are larger than one chunk into sentences.
  const units: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= CHUNK_SIZE) {
      units.push(paragraph);
      continue;
    }

    const sentences = paragraph.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [paragraph];

    for (const sentence of sentences) {
      const trimmed = sentence.trim();

      if (trimmed.length <= CHUNK_SIZE) {
        units.push(trimmed);
        continue;
      }

      // Hard split very long sentences (tables, lists without punctuation).
      for (let start = 0; start < trimmed.length; start += CHUNK_SIZE) {
        units.push(trimmed.slice(start, start + CHUNK_SIZE));
      }
    }
  }

  const chunks: string[] = [];
  let current = "";

  for (const unit of units) {
    if (current && current.length + unit.length + 1 > CHUNK_SIZE) {
      chunks.push(current.trim());

      // Carry over the tail of the previous chunk for context continuity.
      const overlap = current.slice(-CHUNK_OVERLAP);
      const boundary = overlap.indexOf(" ");
      current = boundary >= 0 ? overlap.slice(boundary + 1) : overlap;
    }

    current = current ? `${current}\n${unit}` : unit;
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.filter((chunk) => chunk.length >= 20);
}

/**
 * Creates embeddings using the configured OpenAI embedding model.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const openai = getOpenAIClient();
  const embeddings: number[][] = [];

  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBEDDING_BATCH_SIZE);

    const response = await openai.embeddings.create({
      model: env.OPENAI_EMBEDDING_MODEL,
      input: batch,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    const ordered = [...response.data].sort((a, b) => a.index - b.index);

    for (const item of ordered) {
      embeddings.push(item.embedding);
    }
  }

  return embeddings;
}

function toVectorLiteral(embedding: number[]): string {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding has ${embedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`
    );
  }

  return `[${embedding.map((value) => (Number.isFinite(value) ? value : 0)).join(",")}]`;
}

/**
 * Extracts, chunks, embeds and stores a material document.
 * Updates the material status to READY or FAILED.
 */
export async function ingestMaterial(
  materialId: string,
  buffer: Buffer,
  fileName: string
): Promise<{ chunkCount: number; charCount: number }> {
  try {
    const text = await extractMaterialText(buffer, fileName);

    if (text.length < 50) {
      throw new Error("EMPTY_DOCUMENT");
    }

    const chunks = chunkText(text);
    const embeddings = await embedTexts(chunks);

    await prisma.$transaction(
      async (tx) => {
        await tx.materialChunk.deleteMany({ where: { materialId } });

        for (let index = 0; index < chunks.length; index++) {
          const content = chunks[index];
          const vector = toVectorLiteral(embeddings[index]);

          await tx.$executeRaw`
            INSERT INTO "MaterialChunk"
              ("id", "materialId", "chunkIndex", "content", "tokenCount", "embedding")
            VALUES
              (gen_random_uuid(), ${materialId}::uuid, ${index}, ${content},
               ${Math.ceil(content.length / 4)}, ${vector}::vector)
          `;
        }

        await tx.learningMaterial.update({
          where: { id: materialId },
          data: {
            status: "READY",
            errorMessage: null,
            charCount: text.length,
            embeddingModel: env.OPENAI_EMBEDDING_MODEL,
          },
        });
      },
      { maxWait: 10000, timeout: 120000 }
    );

    return { chunkCount: chunks.length, charCount: text.length };
  } catch (error) {
    const messages: Record<string, string> = {
      UNSUPPORTED_FILE_TYPE: "Format file tidak didukung.",
      EMPTY_DOCUMENT:
        "Teks dokumen tidak dapat dibaca atau terlalu pendek (PDF hasil scan belum didukung).",
    };

    const raw = error instanceof Error ? error.message : String(error);

    await prisma.learningMaterial
      .update({
        where: { id: materialId },
        data: {
          status: "FAILED",
          errorMessage: messages[raw] ?? raw.slice(0, 1000),
        },
      })
      .catch(() => undefined);

    throw error;
  }
}

/**
 * Semantic search over uploaded materials.
 * Materials linked to the given case, plus global materials
 * (no case) matching the context, are searched.
 */
export async function searchMaterialChunks(params: {
  query: string;
  caseId?: string | null;
  context?: string | null;
  limit?: number;
  minSimilarity?: number;
}): Promise<RetrievedChunk[]> {
  const query = params.query.trim();

  if (!query) {
    return [];
  }

  const limit = Math.min(Math.max(params.limit ?? 5, 1), 20);
  const minSimilarity = params.minSimilarity ?? 0.2;
  const caseId = params.caseId ?? null;
  const context = params.context ?? null;

  const [embedding] = await embedTexts([query]);
  const vector = toVectorLiteral(embedding);

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      materialId: string;
      materialTitle: string;
      chunkIndex: number;
      content: string;
      similarity: number;
    }>
  >`
    SELECT
      c."id",
      c."materialId",
      m."title" AS "materialTitle",
      c."chunkIndex",
      c."content",
      1 - (c."embedding" <=> ${vector}::vector) AS "similarity"
    FROM "MaterialChunk" c
    JOIN "LearningMaterial" m ON m."id" = c."materialId"
    WHERE m."status" = 'READY'
      AND c."embedding" IS NOT NULL
      AND (
        ${caseId}::uuid IS NULL
        OR m."caseId" = ${caseId}::uuid
        OR m."caseId" IS NULL
      )
      AND (
        ${context}::text IS NULL
        OR m."context" IS NULL
        OR m."context"::text = ${context}::text
      )
    ORDER BY c."embedding" <=> ${vector}::vector
    LIMIT ${limit}
  `;

  return rows
    .map((row) => ({ ...row, similarity: Number(row.similarity) }))
    .filter((row) => row.similarity >= minSimilarity);
}

/**
 * Retrieves material excerpts for prompting. Never throws:
 * RAG is an enhancement and must not break the learning flow.
 */
export async function retrieveMaterialContext(params: {
  query: string;
  caseId?: string | null;
  context?: string | null;
  limit?: number;
  maxChars?: number;
}): Promise<string> {
  try {
    const chunks = await searchMaterialChunks(params);

    if (chunks.length === 0) {
      return "";
    }

    const maxChars = params.maxChars ?? 6000;
    let total = 0;
    const parts: string[] = [];

    for (const chunk of chunks) {
      const part = `[Sumber: ${chunk.materialTitle} — bagian ${chunk.chunkIndex + 1}]\n${chunk.content}`;

      if (total + part.length > maxChars) {
        break;
      }

      parts.push(part);
      total += part.length;
    }

    return parts.join("\n\n---\n\n");
  } catch (error) {
    console.warn("Material retrieval unavailable:", error instanceof Error ? error.message : error);
    return "";
  }
}
