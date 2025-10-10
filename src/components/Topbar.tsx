"use client";

import { useSession, signOut } from "next-auth/react";
import Image from "next/image";

export default function Topbar() {
  const { data: session, status } = useSession(); // "loading" | "authenticated" | "unauthenticated"

  return (
    <div className="p-3 border-b bg-white flex items-center gap-3">
      <Image
                    src="/aos_logo_v1.png"
                    alt="AOS Logo"
                    width={40}
                    height={40}
                    priority
                    className="inline-block align-middle"
      />
      <div className="font-medium">The Allure Of STEM (AOS)</div>
      <div className="ml-auto flex items-center gap-3">
        {status === "loading" && <span>Checking…</span>}

        {status === "authenticated" && (
          <>
            {session.user?.image && (
              <img
                src={session.user.image}
                alt=""
                className="w-8 h-8 rounded-full"
              />
            )}
            <span className="text-sm text-gray-700">
              {session.user?.email}
            </span>
            <button
              className="px-3 py-1 border rounded"
              onClick={() => signOut({ callbackUrl: "/" })}
            >
              Sign out
            </button>
          </>
        )}

        {status === "unauthenticated" && (
          <span className="text-sm text-gray-600">Not signed in</span>
        )}
      </div>
    </div>
  );
}
