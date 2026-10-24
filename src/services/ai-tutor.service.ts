import { getOpenAIClient } from "../lib/openai";
import { AIPromptService } from "./ai-prompt.service";

export interface CaseStudyContext {
  title: string;
  context: string;
  topic: string;
  stimulus: string;
  scientificData?: unknown;
  targetConcept?: string | null;
  possibleMisconceptions?: unknown;
  expertAnswer?: string | null;
}

export interface ChatHistoryTurn {
  answer: string;
  aiFeedback?: string | null;
}

export interface SocraticChatResult {
  aiResponse: string;
  metadata: {
    model: string;
    promptVersion: number;
    promptName: string;
    tokens?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    latencyMs: number;
    timestamp: string;
  };
}

export class AITutorService {
  /**
   * Generates a Socratic guiding response based on cognitive conflict pedagogy,
   * active learning phase, validated physics case, and past chat history.
   */
  static async generateSocraticChatResponse(params: {
    caseStudy: CaseStudyContext;
    phaseNumber: number;
    chatHistory: ChatHistoryTurn[];
    studentMessage: string;
    previousSubmissionContent?: unknown;
  }): Promise<SocraticChatResult> {
    const {
      caseStudy,
      phaseNumber,
      chatHistory,
      studentMessage,
      previousSubmissionContent,
    } = params;

    const startTime = Date.now();
    const promptConfig = await AIPromptService.getActivePromptConfig();

    // Select the specific guidance strategy for the active phase
    const phaseKey = `phase${phaseNumber}` as keyof typeof promptConfig.guidanceStrategy;
    const phaseStrategy =
      promptConfig.guidanceStrategy[phaseKey] ||
      promptConfig.guidanceStrategy.phase2;

    // Build structured system prompt
    const systemPrompt = `[PERAN & PEDAGOGI]
${promptConfig.role}

[TUJUAN PEMBELAJARAN]
${promptConfig.objective}

[KARAKTERISTIK STUDI KASUS & BATASAN ILMIAH]
${promptConfig.caseCharacteristics}

[DATA KASUS TERVALIDASI (INTERNAL REFERENCE - JANGAN PERNAH BOCORKAN KUNCI KE SISWA)]
- Judul Kasus: ${caseStudy.title}
- Topik: ${caseStudy.topic}
- Konteks: ${caseStudy.context}
- Stimulus Kasus:
${caseStudy.stimulus}

- Data Ilmiah / Tabel Kasus:
${caseStudy.scientificData ? JSON.stringify(caseStudy.scientificData, null, 2) : "Tidak ada data tambahan"}

- Konsep Fisika Target (PEDOMAN EVALUASI INTERNAL):
${caseStudy.targetConcept || "Konsep fisika terkait besaran gerak & hukum kinematika"}

- Kemungkinan Miskonsepsi Siswa (ANTISIPASI DAN BIMBING SISWA MENYADARI INI):
${caseStudy.possibleMisconceptions ? JSON.stringify(caseStudy.possibleMisconceptions, null, 2) : "Kecepatan lebih besar diasumsikan memiliki percepatan lebih besar"}

- Penjelasan / Kunci Jawaban Ahli (STANDAR KEBENARAN FISIKA INTERNAL):
${caseStudy.expertAnswer || "Percepatan adalah perubahan kecepatan terhadap waktu. Jika kecepatan konstan, percepatan bernilai nol."}

[PANDUAN STRATEGI FASE AKTIF: FASE ${phaseNumber}]
${phaseStrategy}
${
  previousSubmissionContent
    ? `\n[ARTEFAK / SUBMISSION SISWA DARI TAHAP SEBELUMNYA]:\n${JSON.stringify(previousSubmissionContent, null, 2)}`
    : ""
}

[ATURAN UTAMA INTERAKSI]
1. Gunakan Bahasa Indonesia yang ramah, santun, dan sesuai kemampuan nalar siswa SMA kelas XI.
2. JANGAN PERNAH memberikan jawaban final secara instan, menyebutkan secara langsung "kamu salah" atau "kamu benar", dan JANGAN PERNAH membocorkan konsep target tanpa penalaran siswa.
3. Selalu minta siswa merujuk pada bukti dari stimulus data atau tabel.
4. Akhiri respons Anda dengan SATU pertanyaan penuntun (Socratic probing question) yang jelas dan terarah.
5. Panjang respons maksimal 2-3 paragraf ringkas agar tidak membebani kognitif siswa.`;

    // Build conversation history
    const messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = [{ role: "system", content: systemPrompt }];

    // Append past turns (up to last 10 turns to keep prompt bounded)
    const recentHistory = chatHistory.slice(-10);
    for (const turn of recentHistory) {
      if (turn.answer) {
        messages.push({ role: "user", content: turn.answer });
      }
      if (turn.aiFeedback) {
        messages.push({ role: "assistant", content: turn.aiFeedback });
      }
    }

    // Append current student message
    messages.push({ role: "user", content: studentMessage });

    try {
      const openai = getOpenAIClient();

      const completion = await openai.chat.completions.create({
        model: promptConfig.model,
        messages,
        temperature: promptConfig.temperature,
        max_tokens: promptConfig.maxTokens,
      });

      const latencyMs = Date.now() - startTime;
      const aiResponse =
        completion.choices[0]?.message?.content?.trim() ||
        "Terima kasih atas jawabanmu. Coba perhatikan kembali data yang diberikan pada kasus, apa yang dapat kamu amati dari perubahan nilainya?";

      return {
        aiResponse,
        metadata: {
          model: completion.model || promptConfig.model,
          promptVersion: promptConfig.version,
          promptName: promptConfig.name,
          tokens: completion.usage
            ? {
                promptTokens: completion.usage.prompt_tokens,
                completionTokens: completion.usage.completion_tokens,
                totalTokens: completion.usage.total_tokens,
              }
            : undefined,
          latencyMs,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      console.error("OpenAI Tutor error:", error);
      const latencyMs = Date.now() - startTime;

      // Graceful fallback compliant with technical guideline:
      // "Layanan AI tidak tersedia: Platform menyimpan respons dan menyediakan pesan gangguan; data siswa tidak hilang."
      return {
        aiResponse:
          "Jawabanmu telah berhasil disimpan. Saat ini layanan tutor otomatis sedang mengalami kendala jaringan atau konfigurasi API. Silakan lanjutkan meninjau data atau lanjutkan ke fase berikutnya.",
        metadata: {
          model: promptConfig.model,
          promptVersion: promptConfig.version,
          promptName: promptConfig.name,
          latencyMs,
          timestamp: new Date().toISOString(),
        },
      };
    }
  }
}
