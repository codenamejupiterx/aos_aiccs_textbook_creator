/* eslint-disable */
// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import "./vars.css"; 
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Allure of STEM (AOS)",
  description: "AOS Textbook Creator",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* neutral so pages can choose their own bg/text */}
      <body className="aos-root min-h-screen antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
