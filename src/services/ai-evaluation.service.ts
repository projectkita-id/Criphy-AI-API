import { getOpenAIClient } from "../lib/openai";
import { AIPromptService } from "./ai-prompt.service";

export interface CaseStudyEvaluationContext {
  title: string;
  context: string;
  topic: string;
  stimulus: string;
  scientificData?: unknown;
  targetConcept?: string | null;
  expertAnswer?: string | null;
}

export interface EssayGradingInput {
  questionText: string;
  rubric?: string | null;
  maxScore: number;
  indicator?: string | null;
  studentAnswer: string;
  caseStudy: CaseStudyEvaluationContext;
}

export interface EssayGradingResult {
  score: number;
  feedback: string;
  indicatorMet: boolean;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
}

export interface PhaseProgressionInput {
  caseStudy: CaseStudyEvaluationContext;
  phase1?: {
    prediction?: string | null;
    reasoning?: string | null;
    confidence?: string | null;
  } | null;
  phase2Responses?: Array<{ answer: string; aiFeedback?: string | null }>;
  phase3Responses?: Array<{ answer: string; aiFeedback?: string | null }>;
  phase4Submission?: {
    claim?: string | null;
    evidence?: string | null;
    reasoning?: string | null;
    alternativeArgument?: string | null;
    revision?: string | null;
  } | null;
  phase5Submission?: {
    understandingChange?: string | null;
    influentialEvidence?: string | null;
  } | null;
}

export interface PhaseEvaluationResult {
  phaseScore: number;
  cerScore: number;
  reflectionScore: number;
  summary: string;
  feedback: string;
  strengths: string[];
  growthAreas: string[];
  criticalThinkingIndicators: {
    interpretation: number;
    analysis: number;
    evaluation: number;
    explanation: number;
    selfRegulation: number;
  };
}

export interface ProgressionCalculationResult {
  prePercentage: number;
  postPercentage: number;
  scoreDifference: number;
  normalizedGain: number;
  phaseScore: number;
  progressionIndex: number;
  progressionLevel:
    | "SANGAT_BAIK"
    | "BAIK"
    | "CUKUP"
    | "PERLU_PENGUATAN";
  progressionLevelLabel: string;
  progressionNarrative: string;
}

export class AIEvaluationService {
  /**
   * Automatically grades an essay answer using OpenAI, evaluating against the
   * question rubric, target physics concepts, and expert answer.
   * Includes a robust fallback if OpenAI is temporarily unreachable.
   */
  static async gradeEssayAnswer(
    input: EssayGradingInput
  ): Promise<EssayGradingResult> {
    const {
      questionText,
      rubric,
      maxScore,
      indicator,
      studentAnswer,
      caseStudy,
    } = input;

    const trimmedAnswer = studentAnswer.trim();

    // If answer is empty or trivially short
    if (!trimmedAnswer || trimmedAnswer.length < 5) {
      return {
        score: 0,
        feedback:
          "Jawaban tidak diberikan atau terlalu singkat untuk dinilai.",
        indicatorMet: false,
        confidence: "HIGH",
      };
    }

    try {
      const promptConfig = await AIPromptService.getActivePromptConfig();
      const openai = getOpenAIClient();

      const systemPrompt = `Anda adalah penilai ahli (evaluator asesmen) pembelajaran fisika SMA kelas XI berbasis Cognitive Conflict dan Berpikir Kritis.
Tugas Anda adalah menilai jawaban esai siswa secara objektif, adil, dan konstruktif berdasarkan rubrik dan standar kebenaran ilmiah yang ditentukan.

[KONTEKS STUDI KASUS]
- Judul Kasus: ${caseStudy.title}
- Topik: ${caseStudy.topic}
- Konteks: ${caseStudy.context}
- Konsep Fisika Target: ${caseStudy.targetConcept || "Konsep kinematika gerak lurus (GLB dan GLBB)"}
- Kunci Jawaban / Penjelasan Ahli: ${caseStudy.expertAnswer || "Kecepatan tetap berarti perubahan kecepatan bernilai nol, sehingga percepatan = 0."}

[INFORMASI SOAL & RUBRIK]
- Soal Esai: ${questionText}
- Indikator Berpikir Kritis: ${indicator || "ANALYSIS / EVALUATION"}
- Skor Maksimum: ${maxScore}
- Panduan Rubrik: ${rubric || "Nilai penuh jika konsep benar dan disertai bukti/alasan logis. Nilai sebagian jika konsep benar namun alasan kurang lengkap. Nilai rendah jika miskonsepsi mendasar."}

[ATURAN PENILAIAN]
1. Berikan skor numerik (score) antara 0 sampai ${maxScore}. Boleh berupa desimal (contoh: ${Math.round(maxScore * 0.8 * 10) / 10}) atau bilangan bulat.
2. Evaluasi apakah siswa memahami konsep fisika target atau masih terjebak miskonsepsi (misal mengira kecepatan besar berarti percepatan besar).
3. Berikan feedback dalam Bahasa Indonesia yang ramah, jelas, mengapresiasi hal yang benar, dan menunjukkan bagian penalaran mana yang perlu disempurnakan.
4. Output WAJIB berupa JSON murni dengan format:
{
  "score": <number antara 0 dan ${maxScore}>,
  "feedback": "<ulasan konstruktif dalam Bahasa Indonesia>",
  "indicatorMet": <boolean true/false>
}`;

      const userContent = `Jawaban Siswa:
"${trimmedAnswer}"

Silakan nilai jawaban di atas sesuai kriteria rubrik dan kembalikan format JSON murni.`;

      const completion = await openai.chat.completions.create({
        model: promptConfig.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      });

      const responseText =
        completion.choices[0]?.message?.content?.trim() || "{}";
      const parsed = JSON.parse(responseText);

      let parsedScore = Number(parsed.score);
      if (Number.isNaN(parsedScore)) {
        parsedScore = maxScore * 0.5;
      }
      // Clamp score within 0 to maxScore
      parsedScore = Math.max(0, Math.min(maxScore, parsedScore));
      // Round to 1 decimal place
      parsedScore = Math.round(parsedScore * 10) / 10;

      const feedback =
        typeof parsed.feedback === "string" && parsed.feedback.trim()
          ? parsed.feedback.trim()
          : "Jawaban telah dievaluasi oleh AI.";

      const indicatorMet = Boolean(parsed.indicatorMet);

      return {
        score: parsedScore,
        feedback,
        indicatorMet,
        confidence: "HIGH",
      };
    } catch (error) {
      console.warn(
        "OpenAI essay grading failed or key unavailable, using heuristic fallback:",
        error
      );
      return this.heuristicEssayGrading(
        trimmedAnswer,
        maxScore,
        caseStudy.targetConcept || "",
        caseStudy.expertAnswer || ""
      );
    }
  }

  /**
   * Rule-based fallback grading when AI service is offline.
   */
  private static heuristicEssayGrading(
    studentAnswer: string,
    maxScore: number,
    targetConcept: string,
    expertAnswer: string
  ): EssayGradingResult {
    const lowerAnswer = studentAnswer.toLowerCase();
    const reference = `${targetConcept} ${expertAnswer}`.toLowerCase();

    // Check key physical terms
    const physicsKeywords = [
      "percepatan",
      "kecepatan",
      "nol",
      "konstan",
      "tetap",
      "berubah",
      "perubahan",
      "waktu",
      "grafik",
      "kemiringan",
      "jarak",
      "selisih",
      "sama",
    ];

    let matchCount = 0;
    for (const kw of physicsKeywords) {
      if (reference.includes(kw) && lowerAnswer.includes(kw)) {
        matchCount++;
      }
    }

    // Check for common misconception negation ("tidak", "bukan", "0", "nol")
    const hasZeroOrNot =
      lowerAnswer.includes("nol") ||
      lowerAnswer.includes("0") ||
      lowerAnswer.includes("sama-sama 0") ||
      lowerAnswer.includes("tidak ada percepatan") ||
      lowerAnswer.includes("tidak memiliki percepatan");

    let scoreRatio = 0.5; // Baseline for attempt
    if (hasZeroOrNot) {
      scoreRatio = 0.9;
    } else if (matchCount >= 4) {
      scoreRatio = 0.75;
    } else if (matchCount >= 2) {
      scoreRatio = 0.6;
    } else if (studentAnswer.length < 20) {
      scoreRatio = 0.3;
    }

    const finalScore = Math.round(maxScore * scoreRatio * 10) / 10;

    const feedback = hasZeroOrNot
      ? "Penjelasanmu sudah tepat dalam mengidentifikasi bahwa pada gerak dengan kecepatan tetap (GLB), percepatannya bernilai nol."
      : "Jawaban telah diperiksa. Penalaranmu sudah menunjukkan upaya mengaitkan besaran gerak, namun pastikan memperjelas bahwa kecepatan yang konstan menghasilkan perubahan kecepatan nol.";

    return {
      score: finalScore,
      feedback,
      indicatorMet: scoreRatio >= 0.7,
      confidence: "MEDIUM",
    };
  }

  /**
   * Evaluates the student's inquiry journey across learning phases 1-5,
   * especially the Claim-Evidence-Reasoning (CER) argumentation and metacognitive reflection.
   */
  static async evaluateLearningPhases(
    input: PhaseProgressionInput
  ): Promise<PhaseEvaluationResult> {
    const {
      caseStudy,
      phase1,
      phase2Responses,
      phase3Responses,
      phase4Submission,
      phase5Submission,
    } = input;

    try {
      const promptConfig = await AIPromptService.getActivePromptConfig();
      const openai = getOpenAIClient();

      const systemPrompt = `Anda adalah penilai ahli pedagogi Cognitive Conflict dan keterampilan berpikir kritis fisika SMA.
Evaluasi kinerja proses pembelajaran siswa selama melewati 5 Fase Pembelajaran:
- Fase 1 (Prior Conception): Prediksi awal dan alasan awal siswa.
- Fase 2 (Cognitive Conflict): Interaksi/tanggapan siswa ketika dihadapkan pada anomali data.
- Fase 3 (Evidence Investigation): Investigasi bukti data/tabel/grafik.
- Fase 4 (Concept Reconstruction): Argumen ilmiah Claim–Evidence–Reasoning (CER).
- Fase 5 (Reflection & Evaluation): Refleksi perubahan pemahaman dan bukti yang paling meyakinkan.

[DATA STUDI KASUS]
- Judul: ${caseStudy.title}
- Topik: ${caseStudy.topic}
- Konsep Fisika Target: ${caseStudy.targetConcept || "GLB dan GLBB"}
- Penjelasan Ahli: ${caseStudy.expertAnswer || "Kecepatan konstan menghasilkan percepatan nol."}

[ATURAN EVALUASI]
1. Berikan skor (0-100) untuk kualitas argumen CER di Fase 4 (cerScore).
2. Berikan skor (0-100) untuk refleksi metakognitif di Fase 5 (reflectionScore).
3. Berikan skor gabungan keseluruhan proses Fase 1–5 (phaseScore) antara 0-100.
4. Buat ringkasan ulasan (summary) 1-2 kalimat tentang perkembangan pemahaman siswa.
5. Buat feedback konstruktif (feedback) untuk siswa dalam Bahasa Indonesia.
6. Sebutkan 2-3 poin kekuatan (strengths) dan 1-2 area peningkatan (growthAreas).
7. Taksir skor 0-100 untuk indikator: interpretation, analysis, evaluation, explanation, selfRegulation.
Output WAJIB berupa JSON murni dengan format:
{
  "phaseScore": <number 0-100>,
  "cerScore": <number 0-100>,
  "reflectionScore": <number 0-100>,
  "summary": "<ringkasan perkembangan>",
  "feedback": "<umpan balik konstruktif>",
  "strengths": ["<poin 1>", "<poin 2>"],
  "growthAreas": ["<poin 1>"],
  "criticalThinkingIndicators": {
    "interpretation": <number 0-100>,
    "analysis": <number 0-100>,
    "evaluation": <number 0-100>,
    "explanation": <number 0-100>,
    "selfRegulation": <number 0-100>
  }
}`;

      const userContent = JSON.stringify({
        phase1: phase1 || "Tidak ada data submisi Fase 1",
        phase2ResponsesCount: phase2Responses?.length ?? 0,
        phase2Sample: phase2Responses?.map((r) => r.answer).slice(-2) ?? [],
        phase3Sample: phase3Responses?.map((r) => r.answer).slice(-2) ?? [],
        phase4CER: phase4Submission || "Tidak ada data CER Fase 4",
        phase5Reflection: phase5Submission || "Tidak ada data refleksi Fase 5",
      });

      const completion = await openai.chat.completions.create({
        model: promptConfig.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      });

      const responseText =
        completion.choices[0]?.message?.content?.trim() || "{}";
      const parsed = JSON.parse(responseText);

      const phaseScore = Math.max(
        0,
        Math.min(100, Math.round(Number(parsed.phaseScore) || 85))
      );
      const cerScore = Math.max(
        0,
        Math.min(100, Math.round(Number(parsed.cerScore) || 85))
      );
      const reflectionScore = Math.max(
        0,
        Math.min(100, Math.round(Number(parsed.reflectionScore) || 85))
      );

      const summary =
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : "Siswa telah menyelesaikan tahapan pembelajaran dan menunjukkan perkembangan pemahaman yang positif melalui bukti ilmiah.";

      const feedback =
        typeof parsed.feedback === "string" && parsed.feedback.trim()
          ? parsed.feedback.trim()
          : "Kerja bagus dalam menelusuri data eksperimen dan merekonstruksi konsep melalui tahapan pembelajaran.";

      const strengths = Array.isArray(parsed.strengths)
        ? parsed.strengths.filter((s: unknown) => typeof s === "string")
        : [
            "Mampu mengidentifikasi pola data gerak pada grafik",
            "Menyusun argumen berdasarkan bukti yang diamati",
          ];

      const growthAreas = Array.isArray(parsed.growthAreas)
        ? parsed.growthAreas.filter((s: unknown) => typeof s === "string")
        : ["Dapat memperjelas hubungan matematis antarbesaran gerak"];

      const cti = parsed.criticalThinkingIndicators || {};
      const criticalThinkingIndicators = {
        interpretation: Math.max(0, Math.min(100, Math.round(Number(cti.interpretation) || 85))),
        analysis: Math.max(0, Math.min(100, Math.round(Number(cti.analysis) || 88))),
        evaluation: Math.max(0, Math.min(100, Math.round(Number(cti.evaluation) || 84))),
        explanation: Math.max(0, Math.min(100, Math.round(Number(cti.explanation) || 87))),
        selfRegulation: Math.max(0, Math.min(100, Math.round(Number(cti.selfRegulation) || 86))),
      };

      return {
        phaseScore,
        cerScore,
        reflectionScore,
        summary,
        feedback,
        strengths,
        growthAreas,
        criticalThinkingIndicators,
      };
    } catch (error) {
      console.warn(
        "OpenAI phase evaluation failed or key unavailable, using heuristic evaluation:",
        error
      );
      return this.heuristicPhaseEvaluation(input);
    }
  }

  /**
   * Rule-based fallback for learning phases evaluation.
   */
  private static heuristicPhaseEvaluation(
    input: PhaseProgressionInput
  ): PhaseEvaluationResult {
    let score = 75;
    const cer = input.phase4Submission;
    const ref = input.phase5Submission;

    let cerScore = 75;
    if (cer?.claim && cer?.evidence && cer?.reasoning) {
      cerScore = 88;
      score += 10;
    }

    let reflectionScore = 75;
    if (ref?.understandingChange && ref?.influentialEvidence) {
      reflectionScore = 88;
      score += 5;
    }

    const finalPhaseScore = Math.min(95, score);

    return {
      phaseScore: finalPhaseScore,
      cerScore,
      reflectionScore,
      summary:
        "Siswa telah menyelesaikan seluruh fase penalaran, menghubungkan anomali data dengan konsep fisika target, dan menyusun argumen ilmiah secara runut.",
      feedback:
        "Proses belajarmu menunjukkan kemajuan bernalar yang sangat baik. Kamu telah mengidentifikasi data grafik dan merevisi konsepsi awal menjadi penjelasan ilmiah yang tepat.",
      strengths: [
        "Mampu mengenali perbedaan antara kecepatan konstan dan percepatan",
        "Menyusun argumen ilmiah (CER) dengan mengacu pada bukti data kasus",
      ],
      growthAreas: [
        "Terus pertahankan kebiasaan mengecek unit satuan dan kemiringan grafik secara teliti",
      ],
      criticalThinkingIndicators: {
        interpretation: finalPhaseScore - 2,
        analysis: finalPhaseScore,
        evaluation: finalPhaseScore - 3,
        explanation: finalPhaseScore,
        selfRegulation: finalPhaseScore - 1,
      },
    };
  }

  /**
   * Calculates the overall learning progression and composite growth index
   * combining pre-test baseline, learning phases 1-5 performance, and post-test mastery.
   */
  static calculateProgression(params: {
    prePercentage: number;
    postPercentage: number;
    phaseScore: number;
  }): ProgressionCalculationResult {
    const { prePercentage, postPercentage, phaseScore } = params;

    const scoreDifference =
      Math.round((postPercentage - prePercentage) * 100) / 100;

    // Standard normalized gain (Hake gain formula)
    let normalizedGain = 0;
    if (prePercentage < 100) {
      const maxPossibleGain = 100 - prePercentage;
      normalizedGain =
        Math.max(0, Math.min(1, (postPercentage - prePercentage) / maxPossibleGain));
      normalizedGain = Math.round(normalizedGain * 100) / 100;
    } else {
      normalizedGain = postPercentage >= 100 ? 1 : 0;
    }

    // Progression index: composite growth metric
    // Combines:
    // - Post-Test mastery: 35%
    // - Learning Phase engagement & reasoning (Fase 1-5): 35%
    // - Gain / Growth achieved (normalized gain * 100): 30%
    const gainComponent = normalizedGain * 100;
    const progressionIndex = Math.min(
      100,
      Math.max(
        0,
        Math.round(
          (postPercentage * 0.35 +
            phaseScore * 0.35 +
            gainComponent * 0.3) *
            100
        ) / 100
      )
    );

    let progressionLevel: ProgressionCalculationResult["progressionLevel"] =
      "CUKUP";
    let progressionLevelLabel = "Cukup (Pemahaman Berkembang)";
    let progressionNarrative = "";

    if (progressionIndex >= 80 || (scoreDifference >= 20 && postPercentage >= 80)) {
      progressionLevel = "SANGAT_BAIK";
      progressionLevelLabel =
        "Sangat Baik (Peningkatan Signifikan & Penguasaan Konsep Mendalam)";
      progressionNarrative = `Pemahamanmu berkembang sangat signifikan dari Pre-Test (${prePercentage}%) hingga Post-Test (${postPercentage}%). Melalui tahapan eksplorasi Fase 1–5 (skor proses ${phaseScore}%), kamu berhasil merekonstruksi konsep fisika secara mandiri dan menyusun argumen ilmiah berbasis bukti yang kokoh.`;
    } else if (progressionIndex >= 65 || scoreDifference > 5) {
      progressionLevel = "BAIK";
      progressionLevelLabel =
        "Baik (Perkembangan Positif & Penalaran Ilmiah Terstruktur)";
      progressionNarrative = `Terdapat peningkatan pemahaman yang konsisten dari Pre-Test (${prePercentage}%) ke Post-Test (${postPercentage}%). Aktivitas belajar di Fase 1–5 membantumu mengurai keraguan konsep awal dan memperjelas hubungan antarbesaran gerak.`;
    } else if (postPercentage >= 70) {
      progressionLevel = "BAIK";
      progressionLevelLabel = "Baik (Penguasaan Konsep Stabil)";
      progressionNarrative = `Kamu mempertahankan pemahaman fisika yang baik sepanjang modul dengan skor Post-Test ${postPercentage}% dan keterlibatan positif di Fase 1–5.`;
    } else {
      progressionLevel = "PERLU_PENGUATAN";
      progressionLevelLabel = "Perlu Penguatan Lanjutan";
      progressionNarrative = `Hasil Post-Test (${postPercentage}%) dan Pre-Test (${prePercentage}%) menunjukkan perlunya penguatan penalaran pada materi ini. Disarankan meninjau kembali argumen CER di Fase 4 serta mencermati bukti grafik gerak.`;
    }

    return {
      prePercentage,
      postPercentage,
      scoreDifference,
      normalizedGain,
      phaseScore,
      progressionIndex,
      progressionLevel,
      progressionLevelLabel,
      progressionNarrative,
    };
  }
}

