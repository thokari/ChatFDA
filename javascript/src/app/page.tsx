import Image from "next/image";
import Chat from "@/components/chat/Chat";
import ExplorerSidebar from "@/components/explorer/ExplorerSidebar";

export default function Home() {
    return (
        <div className="mx-auto flex w-full max-w-6xl gap-6">
            <div className="hidden w-80 shrink-0 md:block">
                <ExplorerSidebar />
            </div>
            <div className="flex-1">
                <div className="mx-auto max-w-3xl">
                    <Chat />
                </div>
            </div>
        </div>
    );
}
