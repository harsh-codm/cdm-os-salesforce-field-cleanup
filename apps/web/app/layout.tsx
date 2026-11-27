import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { ToastProvider } from "@/app/Components/Toast/ToastProvider";
import { RealtimeProvider } from "@/app/lib/ws/RealtimeProvider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CDM-OS | Guardian & Governance",
  description: "Human oversight and governance dashboard for CDM-OS agents.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <RealtimeProvider>
          <ToastProvider>{children}</ToastProvider>
        </RealtimeProvider>
      </body>
    </html>
  );
}
