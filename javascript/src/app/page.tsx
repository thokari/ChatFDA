import Image from "next/image";
import Chat from "@/components/chat/Chat";

export default function Home() {
    return (
        <div className="mx-auto max-w-3xl">
            <Chat />
        </div>
    );
}
