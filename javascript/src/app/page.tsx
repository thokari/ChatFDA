import Image from "next/image";
import Chat from "@/components/chat/Chat";

export default function Home() {
    return (
        <div className="font-sans grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20">
            <main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start">
                <div className="mx-auto max-w-3xl">
                    <h1 className="text-2xl font-semibold mb-4">ChatFDA</h1>
                    <p className="text-sm text-gray-600 mb-4">
                        Ask about dosing, warnings, pregnancy/breastfeeding, contraindications, interactions, and more.
                    </p>
                    <Chat />
                </div>
            </main>
        </div>
    );
}
