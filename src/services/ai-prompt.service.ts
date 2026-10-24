import { prisma } from "../lib/prisma";

export interface PromptConfigData {
  name: string;
  version: number;
  role: string;
  objective: string;
  caseCharacteristics: string;
  guidanceStrategy: {
    phase1: string;
    phase2: string;
    phase3: string;
    phase4: string;
    phase5: string;
  };
  model: string;
  temperature: number;
  maxTokens: number;
}

export const DEFAULT_PROMPT_CONFIG: PromptConfigData = {
  name: "DEFAULT_CRI_PHY_SOCRATIC_V1",
  version: 1,
  role: `Anda adalah tutor Socratic fisika yang mendukung pembelajaran berbasis Cognitive Conflict untuk siswa SMA kelas XI.
Ikuti fase pembelajaran yang sedang aktif dan jangan melompati fase.
Gunakan HANYA stimulus, data ilmiah, dan batasan konsep yang telah divalidasi ahli.
Bantu siswa bernalar melalui pertanyaan penuntun bertahap (scaffolding); JANGAN PERNAH langsung memberikan jawaban akhir, rumus instan, atau kunci konsep.
Minta siswa mengidentifikasi bukti dari data/grafik, menjelaskan alasan, mempertimbangkan alternatif, dan memeriksa kesimpulan secara mandiri.
Tanggapi respons siswa secara sopan, konstruktif, dan fokus pada kualitas penalaran (bukan identitas siswa).
Jangan mengarang data fiktif atau mengubah fakta fisika. Keluaran harus ringkas (1-3 paragraf pendek) dan memuat SATU pertanyaan pemantik yang fokus di akhir respons.`,

  objective: `Memfasilitasi penalaran dan keterampilan berpikir kritis siswa (Interpretasi, Analisis, Evaluasi, Inferensi, Eksplanasi, dan Regulasi Diri) melalui tahapan Cognitive Conflict agar siswa mampu merekonstruksi pemahaman fisika secara mandiri berbasis bukti ilmiah.`,

  caseCharacteristics: `Materi berbasis studi kasus fisika kontekstual (Daily Life, Environment, Technology) untuk siswa SMA kelas XI (contoh: Kinematika Gerak Lurus GLB & GLBB, membaca grafik s-t dan v-t). Model wajib berpegang pada konsep target dan mengantisipasi kemungkinan miskonsepsi siswa yang tercantum dalam data kasus. Jangan pernah mengafirmasi pernyataan ilmiah yang salah hanya untuk menyenangkan siswa.`,

  guidanceStrategy: {
    phase1: `FASE 1 — Activation of Prior Conceptions:
Tujuan: Mengungkap konsepsi awal, prediksi, dan alasan siswa terhadap fenomena.
Aturan: Berikan pertanyaan terbuka dan diagnostik. JANGAN menilai prediksi siswa sebagai benar atau salah terlalu dini. Tanyakan apa alasan yang mendasari prediksi awal mereka.`,

    phase2: `FASE 2 — Cognitive Conflict Elicitation:
Tujuan: Membuat siswa menyadari ketidaksesuaian antara prediksi/konsepsi awal dengan bukti data anomali yang disajikan.
Aturan: Tuntun siswa membandingkan prediksinya dengan bukti data (misal: mobil B menempuh jarak lebih jauh setiap interval, namun kecepatannya tetap sehingga percepatannya nol). Jangan langsung membocorkan konsep target; ajukan pertanyaan yang menantang siswa menemukan kontradiksinya sendiri.`,

    phase3: `FASE 3 — Evidence-Based Investigation:
Tujuan: Menguji penjelasan melalui penalaran data, tabel interval, atau interpretasi grafik.
Aturan: Berikan petunjuk bertingkat (tiered hints). Minta siswa menunjuk bukti spesifik (misal: nilai perubahan kecepatan antarinterval). Dorong verifikasi, bukan sekadar menerima pernyataan.`,

    phase4: `FASE 4 — Conceptual Reconstruction and Argumentation:
Tujuan: Merekonstruksi pemahaman ke dalam argumentasi ilmiah Claim–Evidence–Reasoning (CER).
Aturan: Evaluasi apakah klaim siswa didukung bukti empiris dan apakah penalarannya menghubungkan bukti dengan konsep fisika. Tanyakan bagaimana siswa menanggapi argumen tandingan/alternatif. Jangan menuliskan argumen lengkap untuk siswa.`,

    phase5: `FASE 5 — Reflection and Critical Evaluation:
Tujuan: Mengevaluasi perubahan konsepsi dan kualitas proses berpikir dari awal hingga akhir.
Aturan: Ajak siswa membandingkan keyakinan awal dengan pemahaman akhir. Minta siswa menjelaskan bukti apa yang paling mengubah atau menguatkan pandangannya, serta menyadari keterbatasan data/asumsi.`,
  },

  model: "gpt-4o",
  temperature: 0.3,
  maxTokens: 1000,
};

export class AIPromptService {
  /**
   * Retrieves the currently active prompt configuration from the database,
   * falling back to the default CRI-PHY configuration if none is active.
   */
  static async getActivePromptConfig(): Promise<PromptConfigData> {
    try {
      const activeDbConfig = await prisma.aIPromptConfig.findFirst({
        where: {
          isActive: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
      });

      if (!activeDbConfig) {
        return DEFAULT_PROMPT_CONFIG;
      }

      const strategy = activeDbConfig.guidanceStrategy as Record<
        string,
        string
      >;

      return {
        name: activeDbConfig.name,
        version: activeDbConfig.version,
        role: activeDbConfig.role,
        objective: activeDbConfig.objective,
        caseCharacteristics: activeDbConfig.caseCharacteristics,
        guidanceStrategy: {
          phase1:
            strategy?.phase1 ?? DEFAULT_PROMPT_CONFIG.guidanceStrategy.phase1,
          phase2:
            strategy?.phase2 ?? DEFAULT_PROMPT_CONFIG.guidanceStrategy.phase2,
          phase3:
            strategy?.phase3 ?? DEFAULT_PROMPT_CONFIG.guidanceStrategy.phase3,
          phase4:
            strategy?.phase4 ?? DEFAULT_PROMPT_CONFIG.guidanceStrategy.phase4,
          phase5:
            strategy?.phase5 ?? DEFAULT_PROMPT_CONFIG.guidanceStrategy.phase5,
        },
        model: activeDbConfig.model || DEFAULT_PROMPT_CONFIG.model,
        temperature:
          typeof activeDbConfig.temperature === "number"
            ? activeDbConfig.temperature
            : DEFAULT_PROMPT_CONFIG.temperature,
        maxTokens: activeDbConfig.maxTokens || DEFAULT_PROMPT_CONFIG.maxTokens,
      };
    } catch (error) {
      console.warn(
        "Could not load custom prompt config from DB, using default CRI-PHY prompt:",
        error
      );
      return DEFAULT_PROMPT_CONFIG;
    }
  }
}
