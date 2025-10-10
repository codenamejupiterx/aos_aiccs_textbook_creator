// src/lib/auth.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const authStuff = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },

  providers: [
    Google({
      // keep YOUR existing env var names
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  // ✅ point NextAuth to your custom login page
  pages: {
    signIn: "/login",
  },

  callbacks: {
    /** Runs in middleware. Return true to allow, false to require sign-in. */
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isLoggedIn = !!auth?.user;

      // Protect pages
      if (pathname.startsWith("/dashboard")) return isLoggedIn;

      // Protect app APIs (leave /api/auth/* public)
      if (
        (pathname === "/api/user" ||
          pathname === "/api/generate" ||
          pathname.startsWith("/api/chapters/")) &&
        !pathname.startsWith("/api/auth")
      ) {
        return isLoggedIn;
      }

      // Everything else is public
      return true;
    },

    async jwt({ token, account, profile }) {
      if (account?.provider === "google" && profile?.email) {
        token.email = profile.email as string;
      }
      return token;
    },

    async session({ session, token }) {
      if (token?.email) {
        session.user = { ...session.user, email: token.email } as any;
      }
      return session;
    },
  },
});

// Expose what Next.js needs
export const { auth, signIn, signOut } = authStuff;
export const GET = authStuff.handlers.GET;
export const POST = authStuff.handlers.POST;
