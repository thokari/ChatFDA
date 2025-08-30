export default function AboutPage() {
    return (
        <section className="prose prose-slate max-w-none">
            <h1 className="text-xl font-semibold text-slate-900 mb-2">About</h1>
            <p className="text-sm text-slate-700">
                ChatFDA is an experimental interface that answers questions using FDA drug labeling data.
                It retrieves relevant label sections and drafts concise summaries with citations.
            </p>
            <ul className="mt-3 text-sm text-slate-700 list-disc pl-5">
                <li>Sources: FDA Structured Product Labels</li>
                <li>Features: RAG-based answers, inline sources, compact UI</li>
                <li>Disclaimer: Not medical advice. Always consult official labeling and healthcare professionals.</li>
            </ul>
        </section>
    )
}
