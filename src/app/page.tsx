// src/app/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth();

  if (!session?.user?.email) {
    // Not signed in → send to NextAuth with callback to /welcome
    redirect("/api/auth/signin?callbackUrl=/welcome");
  }

  // Already signed in → go to the landing page
  redirect("/welcome");
}
