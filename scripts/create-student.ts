import "dotenv/config";

import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "../src/lib/prisma";

// ==========================================
// STUDENT SEEDER
// Usage:
//   STUDENT_NAME="..." STUDENT_EMAIL="..." STUDENT_PASSWORD="..." npx tsx scripts/create-student.ts
//
// Or configure these in your .env file:
//   STUDENT_NAME, STUDENT_EMAIL, STUDENT_PASSWORD
// ==========================================

const studentSchema = z.object({
  STUDENT_NAME: z.string().trim().min(2),
  STUDENT_EMAIL: z
    .email()
    .transform((email) => email.toLowerCase()),
  STUDENT_PASSWORD: z.string().min(8),
});

async function main() {
  const parsed = studentSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error(
      "Student configuration validation failed:",
      z.treeifyError(parsed.error)
    );

    console.error(
      "\nUsage: STUDENT_NAME='...' STUDENT_EMAIL='...' STUDENT_PASSWORD='...' npx tsx scripts/create-student.ts"
    );

    throw new Error(
      "Invalid or missing student environment variables"
    );
  }

  const {
    STUDENT_NAME,
    STUDENT_EMAIL,
    STUDENT_PASSWORD,
  } = parsed.data;

  const existingUser = await prisma.user.findUnique({
    where: {
      email: STUDENT_EMAIL,
    },
  });

  if (existingUser) {
    throw new Error(
      `An account with email "${STUDENT_EMAIL}" already exists (role: ${existingUser.role})`
    );
  }

  const passwordHash = await bcrypt.hash(
    STUDENT_PASSWORD,
    12
  );

  const student = await prisma.user.create({
    data: {
      name: STUDENT_NAME,
      email: STUDENT_EMAIL,
      passwordHash,
      role: "STUDENT",
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  console.log("Student account created successfully:");
  console.log(student);
}

main()
  .catch((error) => {
    console.error("Student creation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
