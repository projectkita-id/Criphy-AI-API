import { z } from "zod";

import { getOpenAIClient } from "../lib/openai";
import { AIPromptService } from "./ai-prompt.service";
import { retrieveMaterialContext } from "./material.service";

// ==========================================
// SHARED CASE INPUT
// ==========================================

export interface ContentCaseInput {
  id: string;
  title: string;
  context: string;
  topic: string;
  stimulus: string;
  scientificData?: unknown;
  targetConcept?: string | null;
  possibleMisconceptions?: unknown;
  expertAnswer?: string | null;
}

export interface ContentModuleInput {
  title?: string | null;
  description?: string | null;
  gradeLevel?: string | null;
  learningObjectives?: string | null;
  targetConcepts?: string | null;
}

const CONTEXT_LABELS: Record<string, string> = {
  DAILY_LIFE: "Kehidupan Sehari-hari",
  ENVIRONMENT: "Lingkungan",
  TECHNOLOGY: "Teknologi",
};

function describeCase(caseStudy: ContentCaseInput, module?: ContentModuleInput | null): string {
  const misconceptions = Array.isArray(caseStudy.possibleMisconceptions)
    ? (caseStudy.possibleMisconceptions as unknown[]).map((item) => `- ${String(item)}`).join("\n")
    : caseStudy.possibleMisconceptions
      ? JSON.stringify(caseStudy.possibleMisconceptions)
      : "(tidak dicantumkan)";

  return [
    `Judul kasus: ${caseStudy.title}`,
    `Konteks: ${CONTEXT_LABELS[caseStudy.context] ?? caseStudy.context}`,
    `Topik: ${caseStudy.topic}`,
    `Stimulus kasus:\n${caseStudy.stimulus}`,
    `Data ilmiah kasus: ${caseStudy.scientificData ? JSON.stringify(caseStudy.scientificData) : "(tidak ada)"}`,
    `Konsep target: ${caseStudy.targetConcept || "(tidak dicantumkan)"}`,
    `Kemungkinan miskonsepsi:\n${misconceptions}`,
    `Penjelasan ahli: ${caseStudy.expertAnswer || "(tidak dicantumkan)"}`,
    module?.gradeLevel ? `Jenjang: ${module.gradeLevel}` : null,
    module?.learningObjectives ? `Tujuan pembelajaran modul: ${module.learningObjectives}` : null,
    module?.targetConcepts ? `Konsep target modul: ${module.targetConcepts}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function retrieveForCase(caseStudy: ContentCaseInput, extraQuery = ""): Promise<string> {
  return retrieveMaterialContext({
    query: [caseStudy.topic, caseStudy.targetConcept, caseStudy.title, extraQuery]
      .filter(Boolean)
      .join(". "),
    caseId: caseStudy.id,
    context: caseStudy.context,
    limit: 6,
    maxChars: 7000,
  });
}

async function completeJson(params: {
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
}): Promise<unknown> {
  const promptConfig = await AIPromptService.getActivePromptConfig();
  const openai = getOpenAIClient();

  const completion = await openai.chat.completions.create({
    model: promptConfig.model,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
    temperature: params.temperature,
    max_tokens: params.maxTokens,
    response_format: { type: "json_object" },
  });

  const text = completion.choices[0]?.message?.content?.trim() || "{}";
  return JSON.parse(text);
}

// ==========================================
// PHASE CONTENT
// ==========================================

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const prompts = z.array(text(10, 400)).min(3).max(6);

const cerFieldSchema = z.object({
  label: text(3, 80),
  question: text(10, 400),
  placeholder: text(3, 200),
  hint: text(10, 400),
});

const datasetSchema = z
  .object({
    title: text(3, 200),
    description: text(3, 600),
    xKey: text(1, 40),
    columns: z
      .array(
        z.object({
          key: text(1, 40),
          label: text(1, 80),
        })
      )
      .min(2)
      .max(6),
    rows: z.array(z.record(z.string(), z.union([z.number(), z.string()]))).min(2).max(20),
  })
  .nullable();

export const phaseContentSchema = z.object({
  phaseOne: z.object({
    title: text(3, 200),
    question: text(10, 600),
    prompts,
  }),
  phaseTwo: z.object({
    title: text(3, 200),
    scenario: text(20, 2000),
    question: text(10, 600),
    hint: text(10, 600),
    prompts,
  }),
  phaseThree: z.object({
    title: text(3, 200),
    description: text(10, 1500),
    dataset: datasetSchema,
    question: text(10, 600),
    hint: text(10, 600),
    prompts,
  }),
  phaseFour: z.object({
    title: text(3, 200),
    description: text(10, 1500),
    claim: cerFieldSchema,
    evidence: cerFieldSchema,
    reasoning: cerFieldSchema,
  }),
  phaseFive: z.object({
    title: text(3, 200),
    description: text(10, 1500),
    understandingQuestion: text(10, 600),
    evidenceQuestion: text(10, 600),
    understandingPlaceholder: text(3, 200),
    evidencePlaceholder: text(3, 200),
  }),
});

export type PhaseContent = z.infer<typeof phaseContentSchema> & {
  generatedBy: "AI" | "TEMPLATE";
  generatedAt: string;
  usedMaterials: boolean;
};

/**
 * Keeps dataset rows consistent with the declared columns.
 */
function sanitizeDataset(
  dataset: z.infer<typeof datasetSchema>
): z.infer<typeof datasetSchema> {
  if (!dataset) return null;

  const keys = dataset.columns.map((column) => column.key);

  if (!keys.includes(dataset.xKey)) {
    return null;
  }

  const rows = dataset.rows
    .map((row) => {
      const clean: Record<string, number | string> = {};

      for (const key of keys) {
        const value = row[key];

        if (typeof value === "number" && Number.isFinite(value)) {
          clean[key] = value;
        } else if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
          clean[key] = Number(value);
        } else if (typeof value === "string") {
          clean[key] = value.trim();
        }
      }

      return clean;
    })
    .filter((row) => keys.every((key) => key in row));

  return rows.length >= 2 ? { ...dataset, rows } : null;
}

export function buildTemplatePhaseContent(caseStudy: {
  title: string;
  topic: string;
  context: string;
}): PhaseContent {
  const contextLabel = CONTEXT_LABELS[caseStudy.context] ?? "konteks pembelajaran";
  const caseTitle = caseStudy.title;
  const topic = caseStudy.topic;

  return {
    generatedBy: "TEMPLATE",
    generatedAt: new Date().toISOString(),
    usedMaterials: false,
    phaseOne: {
      title: "Aktivasi Konsepsi Awal",
      question: `Berdasarkan kasus "${caseTitle}", apa prediksi awalmu tentang ${topic}? Jelaskan alasanmu.`,
      prompts: [
        `Apa prediksi awalmu tentang fenomena ${topic} pada kasus ini?`,
        "Konsep atau pengalaman apa yang menjadi dasar prediksimu?",
        "Besaran atau faktor apa yang menurutmu paling menentukan hasilnya? Mengapa?",
        "Bagian mana dari kasus yang masih membuatmu ragu?",
        "Data atau pengamatan apa yang kamu perlukan untuk menguji prediksimu?",
      ],
    },
    phaseTwo: {
      title: `Mengecek Prediksi Awal pada Konteks ${contextLabel}`,
      scenario: `Perhatikan kembali kasus "${caseTitle}". Bandingkan hasil yang benar-benar terjadi pada kasus dengan prediksi yang sebelumnya kamu buat.`,
      question:
        "Apakah prediksi awalmu masih konsisten dengan situasi pada kasus? Jelaskan bagian yang sesuai atau bertentangan.",
      hint: "Fokus pada informasi spesifik dari kasus, bukan pada apa yang kamu harapkan terjadi.",
      prompts: [
        "Informasi apa pada kasus yang bertentangan dengan prediksi awalmu?",
        "Mengapa informasi tersebut dapat mengubah atau menguatkan prediksimu?",
        `Konsep ${topic} mana yang perlu kamu periksa ulang?`,
        "Penjelasan alternatif apa yang mungkin untuk situasi ini?",
      ],
    },
    phaseThree: {
      title: `Investigasi Bukti untuk ${caseTitle}`,
      description: `Gunakan data dan informasi dari kasus untuk menguji penjelasanmu tentang ${topic}.`,
      dataset: null,
      question:
        "Berdasarkan data pada kasus, kesimpulan apa yang paling didukung bukti? Sebutkan data spesifik yang kamu gunakan.",
      hint: "Bandingkan perubahan nilai antarwaktu atau antarkondisi, bukan hanya satu nilai.",
      prompts: [
        "Pola apa yang terlihat dari data pada kasus?",
        "Data spesifik mana yang paling kuat mendukung kesimpulanmu?",
        "Apakah ada data yang tidak sesuai dengan prediksi awalmu? Jelaskan.",
        "Bagaimana konsep fisika menjelaskan pola tersebut?",
      ],
    },
    phaseFour: {
      title: "Menyusun Argumen Berdasarkan Bukti",
      description: `Susun penjelasan ilmiah untuk kasus "${caseTitle}" menggunakan klaim, bukti, dan penalaran.`,
      claim: {
        label: "Claim — Klaim",
        question: "Apa kesimpulan utama yang paling tepat berdasarkan bukti?",
        placeholder: "Tuliskan klaimmu secara ringkas...",
        hint: "Klaim harus menjawab pertanyaan utama kasus secara langsung.",
      },
      evidence: {
        label: "Evidence — Bukti",
        question: "Data atau pengamatan apa yang mendukung klaimmu?",
        placeholder: "Sebutkan data atau observasi spesifik...",
        hint: "Gunakan angka atau fakta dari kasus yang dapat diperiksa ulang.",
      },
      reasoning: {
        label: "Reasoning — Penalaran",
        question: "Bagaimana prinsip fisika menghubungkan bukti dengan klaimmu?",
        placeholder: "Jelaskan hubungan bukti dan konsep...",
        hint: `Hubungkan bukti dengan konsep ${topic}, bukan hanya mengulang data.`,
      },
    },
    phaseFive: {
      title: "Refleksi Perubahan Pemahaman",
      description:
        "Bandingkan prediksi awal dengan pemahaman barumu. Yang dinilai adalah kualitas alasan dan bukti, bukan sekadar perubahan jawaban.",
      understandingQuestion:
        "Bagaimana pemahamanmu tentang konsep ini berubah atau menguat dibandingkan prediksi awal?",
      evidenceQuestion: "Bukti apa yang paling memengaruhi perubahan atau penguatan pandanganmu? Mengapa?",
      understandingPlaceholder: "Bandingkan pemahaman awal dan akhirmu...",
      evidencePlaceholder: "Sebutkan bukti yang paling berpengaruh...",
    },
  };
}

/**
 * Generates case-specific learning content for all five phases.
 * Falls back to a generic template if AI is unavailable.
 */
export async function generatePhaseContent(
  caseStudy: ContentCaseInput,
  module?: ContentModuleInput | null
): Promise<PhaseContent> {
  const materials = await retrieveForCase(caseStudy, "miskonsepsi, contoh soal, data percobaan");

  const system = `Anda adalah perancang pembelajaran fisika SMA berbasis Cognitive Conflict dan keterampilan berpikir kritis.
Rancang konten 5 fase pembelajaran yang SPESIFIK untuk studi kasus di bawah ini. Setiap pertanyaan harus berbobot:
- Mengacu langsung pada detail kasus (objek, angka, kondisi) dan konsep target, bukan pertanyaan generik.
- Menargetkan miskonsepsi yang tercantum, memancing siswa menjelaskan "mengapa", membandingkan, memprediksi, dan menggunakan bukti.
- Bertingkat: Fase 1 menggali konsepsi awal, Fase 2 memunculkan konflik kognitif dengan anomali/kontradiksi yang nyata dari kasus,
  Fase 3 menuntut analisis data kuantitatif, Fase 4 argumentasi CER, Fase 5 refleksi metakognitif.
- JANGAN membocorkan jawaban/konsep target secara eksplisit di pertanyaan atau petunjuk.
- Gunakan Bahasa Indonesia yang jelas untuk siswa SMA.
- Jika materi referensi tersedia, gunakan istilah, definisi, dan contoh dari materi tersebut. Jangan bertentangan dengan materi.
- Data pada fase 3 HARUS konsisten secara fisika dengan kasus. Jika kasus memiliki data ilmiah, gunakan data itu apa adanya.
  Jika kasus tidak memiliki data kuantitatif yang relevan, buat tabel data pengamatan yang realistis dan konsisten dengan stimulus.

Kembalikan JSON murni dengan struktur:
{
  "phaseOne": { "title": string, "question": string (pertanyaan pemantik utama), "prompts": string[4-5] },
  "phaseTwo": { "title": string, "scenario": string (situasi anomali/kontradiksi dari kasus, 2-4 kalimat), "question": string, "hint": string, "prompts": string[4-5] },
  "phaseThree": {
    "title": string, "description": string,
    "dataset": { "title": string, "description": string, "xKey": string, "columns": [{"key": string, "label": string (sertakan satuan)}], "rows": [ { "<key>": number } ] (4-10 baris) },
    "question": string, "hint": string, "prompts": string[4-5]
  },
  "phaseFour": { "title": string, "description": string,
    "claim": {"label": "Claim — Klaim", "question": string, "placeholder": string, "hint": string},
    "evidence": {"label": "Evidence — Bukti", "question": string, "placeholder": string, "hint": string},
    "reasoning": {"label": "Reasoning — Penalaran", "question": string, "placeholder": string, "hint": string} },
  "phaseFive": { "title": string, "description": string, "understandingQuestion": string, "evidenceQuestion": string, "understandingPlaceholder": string, "evidencePlaceholder": string }
}
"xKey" harus salah satu "key" pada "columns" dan setiap baris berisi semua key.`;

  const user = `[STUDI KASUS]
${describeCase(caseStudy, module)}

[MATERI REFERENSI DARI GURU]
${materials || "(tidak ada materi yang diunggah untuk kasus ini)"}`;

  try {
    const raw = await completeJson({ system, user, temperature: 0.4, maxTokens: 3500 });
    const parsed = phaseContentSchema.parse(raw);

    return {
      ...parsed,
      phaseThree: {
        ...parsed.phaseThree,
        dataset: sanitizeDataset(parsed.phaseThree.dataset),
      },
      generatedBy: "AI",
      generatedAt: new Date().toISOString(),
      usedMaterials: Boolean(materials),
    };
  } catch (error) {
    console.warn(
      "AI phase content generation failed, using template:",
      error instanceof Error ? error.message : error
    );
    return buildTemplatePhaseContent(caseStudy);
  }
}

// ==========================================
// ASSESSMENT BLUEPRINT (module + questions)
// ==========================================

const INDICATORS = ["INTERPRETATION", "ANALYSIS", "EVALUATION", "INFERENCE", "EXPLANATION", "SELF_REGULATION"] as const;

const indicatorSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((value) => value.replace(/[\s-]+/g, "_"))
  .pipe(z.enum(INDICATORS))
  .catch("ANALYSIS");

const blueprintSchema = z.object({
  module: z.object({
    title: text(3, 200),
    description: text(10, 2000),
    learningObjectives: z.array(text(5, 400)).min(2).max(6),
    targetConcepts: z.array(text(2, 300)).min(1).max(6),
  }),
  mcq: z
    .array(
      z.object({
        questionText: text(10, 2000),
        options: z
          .array(z.object({ key: text(1, 2), text: text(1, 500) }))
          .length(4),
        correctAnswer: text(1, 2),
        indicator: indicatorSchema,
      })
    )
    .min(3)
    .max(8),
  essay: z
    .array(
      z.object({
        questionText: text(10, 2000),
        rubric: text(30, 4000),
        indicator: indicatorSchema,
      })
    )
    .min(2)
    .max(4),
});

export type AssessmentBlueprint = z.infer<typeof blueprintSchema>;

export const MCQ_MAX_SCORE = 10;
export const ESSAY_MAX_SCORE = 20;

/**
 * Generates module metadata and shared pre/post-test questions
 * from the case study and uploaded materials.
 * Throws when AI is unavailable: no placeholder questions are created.
 */
export async function generateAssessmentBlueprint(
  caseStudy: ContentCaseInput
): Promise<AssessmentBlueprint> {
  const materials = await retrieveForCase(caseStudy, "definisi, rumus, contoh soal");

  const system = `Anda adalah penyusun asesmen fisika SMA yang berpengalaman dan teliti.
Susun modul pembelajaran dan instrumen tes (dipakai sama untuk pre-test dan post-test) untuk studi kasus berikut.

Ketentuan soal:
- 5 soal pilihan ganda (MCQ) dan 3 soal esai. Semua soal harus berkaitan langsung dengan konsep target dan konteks kasus.
- Soal harus mengukur pemahaman konsep dan berpikir kritis (interpretasi data/grafik, analisis, evaluasi klaim, inferensi, eksplanasi), bukan hafalan.
- MCQ: tepat 4 opsi dengan key "A","B","C","D". Hanya satu jawaban benar. Pengecoh (distractor) disusun dari miskonsepsi yang umum/tercantum, masuk akal, dan panjangnya setara dengan jawaban benar. Variasikan posisi jawaban benar.
- Esai: menuntut penjelasan dengan alasan dan bukti. Sertakan rubrik analitik skor 0-${ESSAY_MAX_SCORE} dengan kriteria jelas per rentang, wajib memuat:
  * ${ESSAY_MAX_SCORE}: konsep benar, alasan lengkap, menggunakan bukti/data yang relevan.
  * 13-19: konsep benar, alasan/bukti kurang lengkap.
  * 6-12: sebagian konsep benar atau masih ada miskonsepsi minor.
  * 1-5: ada upaya relevan tetapi konsep keliru.
  * 0: kosong, tidak relevan dengan soal, atau hanya mengulang soal.
  Rubrik juga menyebutkan poin kunci jawaban ideal.
- Jangan bertentangan dengan materi referensi guru jika tersedia.
- Bahasa Indonesia baku dan jelas.
- indicator salah satu: ${INDICATORS.join(", ")}.

Kembalikan JSON murni:
{
  "module": { "title": string, "description": string, "learningObjectives": string[], "targetConcepts": string[] },
  "mcq": [ { "questionText": string, "options": [{"key":"A","text":string},{"key":"B","text":string},{"key":"C","text":string},{"key":"D","text":string}], "correctAnswer": "A"|"B"|"C"|"D", "indicator": string } ],
  "essay": [ { "questionText": string, "rubric": string, "indicator": string } ]
}`;

  const user = `[STUDI KASUS]
${describeCase(caseStudy)}

[MATERI REFERENSI DARI GURU]
${materials || "(tidak ada materi yang diunggah untuk kasus ini)"}`;

  const raw = await completeJson({ system, user, temperature: 0.3, maxTokens: 4000 });
  const blueprint = blueprintSchema.parse(raw);

  for (const question of blueprint.mcq) {
    const keys = question.options.map((option) => option.key.toUpperCase());

    if (new Set(keys).size !== 4 || !keys.includes(question.correctAnswer.toUpperCase())) {
      throw new Error("AI generated an invalid multiple-choice answer key");
    }
  }

  return blueprint;
}
