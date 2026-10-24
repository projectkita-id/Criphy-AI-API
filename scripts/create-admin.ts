import "dotenv/config";

import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "../src/lib/prisma";

// ==========================================
// ADMIN SEEDER
// Usage:
//   npx tsx scripts/create-admin.ts
//
// Requires in .env:
//   ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD (min 12 chars)
// ==========================================

const adminSchema = z.object({
  ADMIN_NAME: z.string().trim().min(2),
  ADMIN_EMAIL: z.email().transform((email) =>
    email.toLowerCase()
  ),
  ADMIN_PASSWORD: z.string().min(12),
});

async function main() {
  const parsed = adminSchema.safeParse(process.env);

    if (!parsed.success) {
    console.error(
        "Admin configuration validation failed:",
        z.treeifyError(parsed.error)
    );

    throw new Error(
        "Invalid or missing admin environment variables"
    );
    }

  const {
    ADMIN_NAME,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
  } = parsed.data;

  const existingUser = await prisma.user.findUnique({
    where: {
      email: ADMIN_EMAIL,
    },
  });

  if (existingUser) {
    throw new Error(
      "An account with this email already exists"
    );
  }

  const passwordHash = await bcrypt.hash(
    ADMIN_PASSWORD,
    12
  );

  const admin = await prisma.user.create({
    data: {
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      passwordHash,
      role: "ADMIN",
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  });

  console.log("Admin account created successfully:");
  console.log(admin);
}

main()
  .catch((error) => {
    console.error("Admin creation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });