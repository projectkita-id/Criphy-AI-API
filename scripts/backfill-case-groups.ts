
import "dotenv/config";

import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";

async function main() {
  const cases = await prisma.validatedCase.findMany({
    where: {
      caseGroupId: null,
    },
    select: {
      id: true,
      title: true,
      version: true,
    },
  });

  console.log(`Found ${cases.length} cases to backfill.`);

  for (const caseStudy of cases) {
    const result = await prisma.validatedCase.updateMany({
      where: {
        id: caseStudy.id,
        caseGroupId: null,
      },
      data: {
        caseGroupId: randomUUID(),
      },
    });

    if (result.count === 1) {
      console.log(
        `Assigned case group to: ${caseStudy.title} (v${caseStudy.version})`
      );
    }
  }

  const remaining = await prisma.validatedCase.count({
    where: {
      caseGroupId: null,
    },
  });

  console.log(`Remaining cases without a group: ${remaining}`);

  if (remaining > 0) {
    throw new Error("Case group backfill is incomplete");
  }

  console.log("Case group backfill completed successfully.");
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });