import type { Metadata } from "next";
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
            <body className={`${sans.className} ${mono.variable} antialiased bg-white text-black`}>
                {children}
            </body>
        </html>
    );
}
