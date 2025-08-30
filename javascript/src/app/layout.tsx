import type { Metadata } from "next";
import Link from "next/link";
import { Source_Sans_3, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const sans = Source_Sans_3({
    subsets: ["latin"],
    weight: ["300", "400", "500", "600", "700"],
    variable: "--font-sans",
});
const mono = IBM_Plex_Mono({
    subsets: ["latin"],
    weight: ["400", "500", "600", "700"],
    variable: "--font-mono",
});

export const metadata: Metadata = {
    title: "ChatFDA",
    description: "Chat-based RAG on FDA labels",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className={`${sans.className} ${mono.variable} antialiased bg-sky-50 text-slate-900 min-h-screen flex flex-col`}>
                <header className="sticky top-0 z-30 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-b border-slate-200">
                    <div className="mx-auto max-w-5xl w-full px-4 sm:px-6 py-3 flex items-center gap-4">
                        <Link href="/" className="text-sky-800 font-semibold">ChatFDA</Link>
                        <nav className="ml-auto flex items-center gap-4 text-sm">
                            <Link className="text-slate-700 hover:text-sky-700" href="/about">About</Link>
                        </nav>
                    </div>
                </header>
                <main className="mx-auto max-w-5xl w-full px-4 sm:px-6 py-8 flex-1">
                    {children}
                </main>
                <footer className="border-t border-slate-200 bg-white/60">
                    <div className="mx-auto text-center max-w-5xl w-full p-4 text-[12px] text-slate-600">
                        This tool summarizes FDA label information. Not medical advice.
                    </div>
                </footer>
            </body>
        </html>
    );
}
