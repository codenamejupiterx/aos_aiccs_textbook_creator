/* eslint-disable */
// src/app/welcome/page.tsx
import Image from "next/image";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import VideoPlayer from "@/components/VideoPlayer";
import Link from "next/link";





type CardProps = {
  edgeBg: string;      // e.g. "bg-indigo-500"
  edgeBorder: string;  // e.g. "border-indigo-500"
  title: React.ReactNode;
  children: React.ReactNode;
};

function Card({ edgeBg, edgeBorder, title, children }: CardProps) {
  return (
    <div className="relative h-full">
      <span className={`absolute top-0 left-0 w-full h-full mt-1 ml-1 rounded-lg ${edgeBg}`} />
      <div className={`relative h-full p-5 bg-white rounded-lg border-2 ${edgeBorder} flex flex-col`}>
        {/* Header */}
        <div className="flex items-baseline -mt-1">
          <h3 className="my-2 ml-3 text-lg font-bold text-gray-800 leading-6">
            {title}
          </h3>
        </div>

        {/* dashed accent (slightly tighter) */}
        <p className={`mt-1 mb-3 text-xs font-medium uppercase ${edgeBorder.replace("border-","text-")}`}>
          ------------
        </p>

        {/* content fills the rest */}
        <div className="text-gray-600 flex-1">{children}</div>
      </div>
    </div>
  );
}

export default async function WelcomePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/?next=/welcome");

  const fullName = session.user?.name || "";
  const firstName = fullName.split(" ")[0] || fullName || "there";

  return (
    <main className="container relative max-w-7xl px-6 sm:px-10 mx-auto mt-6">
      {/*
        GRID
        - 1 col on phones, 2 cols on small/medium, 3 cols on large+
        - auto-rows-[300px] makes each tile exactly 300px tall (tweak as you like)
      */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6 auto-rows-[300px]">
        <Card
            edgeBg="bg-indigo-500"
            edgeBorder="border-indigo-500"
            title={
                <>
                {/* <span>Welcome</span> */}
                <span className="ml-2 text-sm font-normal text-gray-500">
                    Hello, <span className="font-semibold text-gray-900">{firstName}</span>
                </span>
                </>
            }
            >
            {/* Fill the card and center things nicely */}
            <div className="h-full flex flex-col items-center text-center gap-3">
                <h4 className="text-[17px] sm:text-lg font-semibold text-gray-800">
                Create a <span className="underline decoration-indigo-400">customized reading</span>
                </h4>

                {/* Clickable logo (also links to the form) */}
                <Link href="/dashboard" className="group mt-1" aria-label="Go to the form to create a custom reading">
                <Image
                    src="/aos_logo_v1.png"
                    alt="AOS Logo"
                    width={70}
                    height={70}
                    className="rounded-md transition-transform group-hover:scale-105"
                    priority
                />
                </Link>

                <p className="text-sm text-gray-500">Enjoy! 🎉</p>

                {/* Primary CTA pinned to the bottom of the tile */}
                <Link
                href="/dashboard"
                className="mt-auto inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-white font-semibold shadow hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                Start your custom reading →
                </Link>
            </div>
        </Card>


        <Card
          edgeBg="bg-purple-500"
          edgeBorder="border-purple-500"
          title="AI Custom Readings Make Learning Fun!"
        >
          {/* compact media so it fits in a 300px tile */}
          <div className="relative w-full aspect-[16/9] max-h-[160px] overflow-hidden rounded-md border-2 border-purple-200">
            <Image
              src="/people_reading.png"
              alt="Students reading on books, phones and laptops in a fun, spacey scene"
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 50vw"
              priority
            />
          </div>
        </Card>

        <Card edgeBg="bg-blue-400" edgeBorder="border-blue-400" title="About AOS">
          At AOS, we build custom curricula with AICCS — our Artificial Intelligence Custom
          Curriculum System. AICCS tailors readings to each learner’s interests so comprehension,
          confidence, and curiosity grow together.
        </Card>

        <Card edgeBg="bg-yellow-400" edgeBorder="border-yellow-400" title="Our Mission">
          Make reading irresistible to increase learning for everyone. We blend educator insight with
          AI personalization to deliver engaging texts, relevant examples, and scaffolded supports.
        </Card>

        <Card edgeBg="bg-green-500" edgeBorder="border-green-500" title="News">
          <VideoPlayer
            src="/news_rep_pressley_300000_unemployed.mp4"
            poster="/unemployed_aa_female_pop.png"
          />
        </Card>

        <Card edgeBg="bg-emerald-500" edgeBorder="border-emerald-500" title="Long-Term Goals">
          AOS aims to help address unemployment among African American women using AICCS. We support career 
          pivots with personalized learning plans and practical upskilling, and we’re seeking local partners 
          to connect learners to stable, gainful employment.

        </Card>
      </section>
    </main>
  );
}
