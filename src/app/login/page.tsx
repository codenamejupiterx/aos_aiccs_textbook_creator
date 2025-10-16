/* eslint-disable */
"use client";

import { signIn } from "next-auth/react";
import Topbar from "@/components/Topbar";

export default function LoginPage() {
  return (
    <>
      <Topbar />
      {/* If AppHeader is sticky/fixed, add top padding: */}
      <main className="min-h-screen w-screen flex items-center justify-center bg-white p-5 pt-16">
        <figure className="relative w-[3in] h-[4.5in] overflow-hidden rounded-2xl shadow-lg border-4 border-gray-300 bg-white">
          {/* 10px padding on the image */}
          <img
            src="/AOS_login_page_pic.png"
            alt="AOS AICCS welcome"
            className="absolute inset-0 h-full w-full object-cover p-2.5"
          />

          {/* Bottom overlay (centered text) */}
          <figcaption className="absolute inset-x-0 bottom-0 bg-white/92 backdrop-blur px-4 py-4 text-center">
            <h1 className="text-lg font-semibold">The Allure Of STEM (AOS)</h1>
            <p className="mt-1 text-sm text-gray-600">
              AI Custom Curriculum Software(AICCS)
            </p>

            <button
              className="mt-3 w-full rounded-lg border border-gray-200 px-4 py-2.5 font-medium shadow hover:shadow-md transition"
              onClick={() => signIn("google", { callbackUrl: "/welcome" })}
            >
              Sign in with Google
            </button>

            <p className="mt-2 text-[11px] text-gray-500">Enjoy!</p>
          </figcaption>
        </figure>
      </main>
    </>
  );
}
