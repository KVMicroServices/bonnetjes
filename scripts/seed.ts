import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD;
const ADMIN_NAME = process.env.ADMIN_SEED_NAME || "Admin";

async function main() {
  console.log("Seeding database...");

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("Missing required env vars: ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD");
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      name: ADMIN_NAME,
      password: hashedPassword,
      role: "admin",
    },
    create: {
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      password: hashedPassword,
      role: "admin",
    },
  });
  console.log("Admin user seeded:", admin.email);

  console.log("Seeding completed!");
}

main()
  .catch((error) => {
    console.error("Seeding error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
